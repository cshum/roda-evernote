var ginga  = require('ginga'),
    params = ginga.params,
    extend = require('extend'),
    H      = require('highland'),
    SDK    = require('evernote').Evernote,
    store  = require('./store');

var MINS_15 = 15 * 60 * 1000;

function Evernote(roda, name, options){
  if(!(this instanceof Evernote))
    return new Evernote(roda, name, options);
  this.options = options;

  this.roda = roda;
  this.store = store(roda, name);
  this.store.getStream = H.wrapCallback(this.store.get);
}

var app = ginga(Evernote.prototype);

//Evernote Sync
app.define('sync', params('token:string'), function(ctx, next){
  ctx.client = new SDK.Client({ 
    token: ctx.params.token
  });
  ctx.userStore = ctx.client.getUserStore();
  ctx.userStore.getUser(function(err, user) {
    if(err) return next(err);
    ctx.user = user;
    next();
  });
}, function(ctx, next, end){
  var tx = this.roda.transaction();
  var id = String(ctx.user.id);
  this.store.get(id, tx, function(err, doc){
    doc = doc || {};
    doc.type = 'meta';
    doc.userId = id;
    doc.user = ctx.user;

    ctx.meta = doc;
    this.put(id, doc, tx);
  });
  tx.commit(function(err){
    if(err) return next(err);
    next();
  });
}, function(ctx, next){
  ctx.noteStore = ctx.client.getNoteStore();
  ctx.noteStore.getSyncState(function(err, state){
    if(err) return next(err);
    ctx.syncState = state;
    next();
  });
}, function(ctx, next){
  ctx.meta.lastUpdateCount = ctx.meta.lastUpdateCount || 0;

  var self = this;
  var full = !ctx.meta.lastUpdateCount;
  function syncChunk(cb){
    self._syncChunk(ctx.meta.userId, ctx.noteStore, full, function(err, usn){
      if(err) return cb(err);
      if(ctx.syncState.updateCount === usn) return cb();
      syncChunk(cb);
    });
  }

  if(ctx.syncState.updateCount === ctx.meta.lastUpdateCount){
    next();
  }else{
    syncChunk(next);
  }
}, function(ctx, done){
  var self = this;

  this.store.readStream({
    index: 'user_dirty',
    prefix: [ctx.meta.userId]
  })
  .map(H.wrapCallback(function(doc, cb){
    self._update(ctx.meta.userId, ctx.noteStore, doc, cb);
  }))
  .parallel(1)
  .collect()
  .pull(done);
});

app.define('_syncChunk', params('id', 'noteStore', 'full:boolean'), function(ctx, next, end){
  ctx.transaction = this.roda.transaction({ ttl: 60 * 1000 });
  ctx.noteStore = ctx.params.noteStore;

  end(function(){
    ctx.transaction.rollback();
  });
  this.store.get(ctx.params.id, ctx.transaction, function(err, user){
    if(err) return next(err);
    ctx.meta = user;
    next();
  });
}, function(ctx, next){
  var lastUpdated = ctx.meta.lastUpdateCount || 0;
  ctx.noteStore.getSyncChunk(lastUpdated, 30, !!ctx.params.full, function(err, chunk){
    if(err) return next(err);
    ctx.chunk = chunk;
    next();
  });
}, function(ctx, done){
  var self = this;

  (ctx.chunk.notebooks || []).forEach(function(doc){
    doc.type = 'notebook';
    doc.userId = ctx.meta.userId;
    if(doc.defaultNotebook)
      ctx.meta.defaultNotebookGuid = doc.guid;
    self.store.put(doc.guid, doc, ctx.transaction);
  });
  (ctx.chunk.tags || []).forEach(function(doc){
    doc.type = 'tag';
    doc.userId = ctx.meta.userId;
    //check tag conflict
    ctx.transaction.defer(function(cb){
      self.store.readStream({
        index: 'user_tags',
        eq: [doc.userId, doc.name],
        limit: 1
      }).collect().pull(function(err, list){
        if(err) 
          return done(err);
        if(list.length){
          var curr = list[0];
          //make way for synced tag
          if(curr._id !== doc.guid)
            self.store.put(curr._id, {
              type: 'link',
              link: doc.guid
            }, ctx.transaction);
        }
        cb();
      });
    });
    self.store.put(doc.guid, doc, ctx.transaction);
  });
  (ctx.chunk.notes || []).forEach(function(doc){
    ctx.transaction.defer(function(cb){
      doc.type = 'note';
      doc.userId = ctx.meta.userId;
      //clean up
      delete doc.contentHash;
      delete doc.contentLength;
      //get note content
      ctx.noteStore.getNoteContent(doc.guid, function(err, content){
        if(err) return cb(err);
        doc.content = content;
        self.store.put(doc.guid, doc, ctx.transaction, cb);
      });
    });
  });

  [].concat(
    ctx.chunk.expungedLinkedNotebooks || [],
    ctx.chunk.expungedSearches || [],
    ctx.chunk.expungedNotes || [],
    ctx.chunk.expungedNotebooks || [],
    ctx.chunk.expungedTags || []
  ).forEach(function(guid){
    self.store.del(guid, ctx.transaction);
  });

  ctx.meta.lastUpdateCount = ctx.chunk.chunkHighUSN;
  ctx.meta.lastSyncTime = ctx.chunk.currentTime;

  this.store.put(ctx.meta.userId, ctx.meta, ctx.transaction);

  ctx.transaction.commit(function(err){
    if(err) return done(err);
    done(null, ctx.chunk.chunkHighUSN);
  });
});

app.define('_update', params('id', 'noteStore', 'doc'), function(ctx, next){
  ctx.noteStore = ctx.params.noteStore;
  ctx.doc = ctx.params.doc;

  var self = this;
  var getLink = H.wrapCallback(function(id, cb){
    self.store.get(id, function(err, res){
      if(err && !err.notFound) 
        return next(err);
      cb(null, res && res.link ? res.link : id);
    });
  });

  H(['tagGuids', 'notebookGuid']).map(H.wrapCallback(function(field, cb){
    if(Array.isArray(ctx.doc[field])){
      H(ctx.doc[field])
        .map(getLink)
        .parallel(1)
        .toArray(function(guids){
          ctx.doc[field] = guids;
          cb();
        });
    }else if(typeof ctx.doc[field] === 'string'){
      getLink(ctx.doc[field]).apply(function(guid){
        ctx.doc[field] = guid;
        cb();
      });
    }else{
      cb();
    }
  })).parallel(2).done(function(){
    next();
  });
}, function(ctx, next){
  var isCreate = !ctx.doc.guid;
  var self = this;

  function callback(err, res){
    if(err) return next(err);
    res.type = ctx.doc.type;
    res.userId = ctx.params.id;
    ctx.result = res;
    next();
  }

  switch(ctx.doc.type){
    case 'notebook':
      var notebook = new SDK.Notebook();
      extend(notebook, ctx.doc);
      ctx.noteStore[isCreate ? 'createNotebook': 'updateNotebook'](notebook, callback);
      break;
    case 'note':
      var content = ctx.doc.content;
      var note = new SDK.Note();
      extend(note, ctx.doc);
      if(!ctx.doc.contentDirty) delete note.content;

      ctx.noteStore[isCreate ? 'createNote': 'updateNote'](note, function(err, doc){
        if(err) return next(err);
        //get note content
        doc.content = content;
        //clean up
        delete doc.contentHash;
        delete doc.contentLength;
        callback(null, doc);
      });
      break;
    case 'tag':
      var tag = new SDK.Tag();
      extend(tag, ctx.doc);
      ctx.noteStore[isCreate ? 'createTag': 'updateTag'](tag, callback);
      break;
  }
}, function(ctx, done){
  var tx = this.roda.transaction();

  //if create, remove dirty doc
  if(!ctx.doc.guid)
    this.store.put(ctx.doc._id, {
      type: 'link',
      link: ctx.result.guid
    }, tx);
  //update result
  this.store.put(ctx.result.guid, ctx.result, tx);
    
  //update meta
  this.store.get(ctx.params.id, tx, function(err, meta){
    if(err) return tx.rollback(err);
    //update defaultNotebookGuid if linked
    if(meta.defaultNotebookGuid === ctx.doc._id) 
      meta.defaultNotebookGuid = ctx.result.guid;
    //lastUpdateCount
    meta.lastUpdateCount = ctx.result.updateSequenceNum;
    this.put(ctx.params.id, meta, tx);
  });

  tx.commit(function(err){
    if(err) return done(err);
    done(null, ctx.result);
  });
});

module.exports = Evernote;
