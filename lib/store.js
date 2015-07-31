var SDK = require('evernote').Evernote;

var TAG_REGEX = new RegExp(SDK.EDAM_TAG_NAME_REGEX, "i");
var TYPE_SYNCABLE = {
  'tag': 1,
  'notebook': 2,
  'note': 3,
  'search': 4,
  'link': 0,
  'meta': 0
};

module.exports = function(roda, store){
  return (typeof store === 'string' ? roda(store) : store)
    .use('validate', function(ctx){
      //clean up
      delete ctx.result.defaultNotebook;
      delete ctx.result.contentHash;
      delete ctx.result.contentLength;
    })
    .use('diff', function(ctx, next){
      ctx.sticky = function(){
        Array.prototype.slice.call(arguments).forEach(function(field){
          if(!(field in ctx.result) && ctx.current && field in ctx.current)
            ctx.result[field] = ctx.current[field];
        });
      };
      //Sticky fields
      ctx.sticky('type', 'guid', 'userId');
      //type validation
      if(!(ctx.result.type in TYPE_SYNCABLE))
        return next(roda.error(400, 'type', 'Invalid type.'));
      //require userId
      if(!ctx.result.userId)
        return next(roda.error(400, 'userId', 'User missing.'));

      next();
    }, function(ctx){
      var self = this;
      //dirty flag detection
      if(ctx.result && TYPE_SYNCABLE[ctx.result.type]){
        var newSeq = ctx.result.updateSequenceNum || 0;
        var currSeq = ctx.current ? (ctx.current.updateSequenceNum || 0) : 0;
        if( !newSeq || newSeq <= currSeq ){
          ctx.result.dirty = true;
          delete ctx.result.updateSequenceNum;
        }
      }
      if(ctx.result.dirty){
        switch(ctx.result.type){
          case 'notebook':
          case 'tag':
            //notebook and tag sticky
            ctx.sticky('name');
          break;
          case 'note':
            //note sticky fields
            ctx.sticky('title', 'content', 'active', 'tagGuids', 'notebookGuid');
            ctx.result.active = ctx.result.active !== false;
            //local timestamp
            if(!ctx.current) 
              ctx.result.created = Date.now();
            else 
              ctx.result.created = ctx.current.created;

            if(ctx.result.active) {
              ctx.result.deleted = null;
              ctx.result.updated = Date.now(); 
            }else
              ctx.result.deleted = Date.now();

            //content dirty detection
            if(!ctx.current || ctx.current.contentDirty || 
               ctx.current.content !== ctx.result.content){
              ctx.result.contentDirty = true;
            }
            //default notebook
            if(!ctx.result.notebookGuid){
              this.get(ctx.result.userId, ctx.transaction, function(err, meta){
                if(meta.defaultNotebookGuid)
                  ctx.result.notebookGuid = meta.defaultNotebookGuid;
              });
            }
            //tags handling
            if(Array.isArray(ctx.result.tags)){
              var tagGuids = {}; //existing tag guids
              var newTags = {}; //new tag names
              if(!Array.isArray(ctx.result.tagGuids))
                ctx.result.tagGuids = [];
              ctx.result.tagGuids.forEach(function(guid){
                tagGuids[guid] = true;
              });
              ctx.result.tags.forEach(function(name){
                newTags[String(name).toLowerCase()] = name;
              });
              ctx.transaction.defer(function(cb){
                self.readStream({
                  index: 'user_tag',
                  prefix: [ctx.result.userId]
                }).each(function(doc){
                  var key = String(doc.name).toLowerCase();
                  if(tagGuids[doc._id]){ //existing tag guids
                    delete newTags[key];
                  }else if(newTags[key]){ //guid not exists, but name exists
                    ctx.result.tagGuids.push(doc._id); //add guid
                    delete newTags[key];
                  }
                }).done(cb); 
              });
              ctx.transaction.defer(function(cb){
                function add(err, doc){
                  if(doc) ctx.result.tagGuids.push(doc._id);
                }
                for(var key in newTags){
                  self.post({
                    type: 'tag',
                    userId: ctx.result.userId,
                    name: newTags[key]
                  }, ctx.transaction, add);
                }
                cb();
              });
            }
            delete ctx.result.tags;
          break;
        }
      }
    })
    .registerIndex('user_seq', function(doc, emit){
      if(doc.updateSequenceNum) 
        emit([doc.userId, doc.updateSequenceNum], true);
    })
    .registerIndex('user_notebook', function(doc, emit){
      if(doc.type === 'notebook') 
        emit([doc.userId, String(doc.name).toLowerCase()], true); 
        //case insensitive unique per user
    })
    .registerIndex('user_tag', function(doc, emit){
      if(doc.type === 'tag') 
        emit([doc.userId, String(doc.name).toLowerCase()], true); 
        //case insensitive unique per user
    })
    .registerIndex('user_dirty', function(doc, emit){
      if(doc.dirty) 
        emit([doc.userId, TYPE_SYNCABLE[doc.type]]);
    })
    .registerIndex('trash', function(doc, emit){
      if(doc.type === 'note' && !doc.active)
        emit(doc.deleted); 
    })
    .registerIndex('note', function(doc, emit){
      if(doc.type === 'note' && doc.active)
        emit(doc.updated); 
    })
    .rebuildIndex(1);
};
