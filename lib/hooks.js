var ginga = require('ginga');
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

var hooks = module.exports = ginga();

hooks.use('init', function(){
  this.registerIndex('user_seq', function(doc, emit){
    if(doc.updateSequenceNum) 
      emit([doc.userId, doc.updateSequenceNum], true);
  });
  this.registerIndex('user_notebook', function(doc, emit){
    if(doc.type === 'notebook') 
      emit([doc.userId, String(doc.name).toLowerCase()], true); 
      //case insensitive unique per user
  });
  this.registerIndex('user_tag', function(doc, emit){
    if(doc.type === 'tag') 
      emit([doc.userId, String(doc.name).toLowerCase()], true); 
      //case insensitive unique per user
  });
  this.registerIndex('user_dirty', function(doc, emit){
    if(doc.dirty) 
      emit([doc.userId, TYPE_SYNCABLE[doc.type]]);
  });
  this.registerIndex('trash', function(doc, emit){
    if(doc.type === 'note' && !doc.active)
      emit(doc.deleted); 
  });
  this.registerIndex('note', function(doc, emit){
    if(doc.type === 'note' && doc.active)
      emit(doc.updated); 
  });
  this.rebuildIndex(1);
});

hooks.use('validate', function(ctx){
  //clean up
  delete ctx.result.defaultNotebook;
  delete ctx.result.contentHash;
  delete ctx.result.contentLength;

  //hash to hex
  (ctx.result.resources || []).forEach(function(res){
    if(res.data)
      res.data.bodyHash = Buffer(res.data.bodyHash)
        .toString('hex');
    if(res.recognition)
      res.recognition.bodyHash = Buffer(res.recognition.bodyHash)
        .toString('hex');
  });
});

hooks.use('diff', function(ctx, next){
  if(!ctx.result) return next();

  function sticky(){
    if(ctx.current)
      Array.prototype.slice.call(arguments).forEach(function(field){
        if(!(field in ctx.result) && (field in ctx.current))
          ctx.result[field] = ctx.current[field];
      });
  }
  //Sticky fields
  sticky('type', 'guid', 'userId');
  //type validation
  if(!(ctx.result.type in TYPE_SYNCABLE))
    return next(roda.error(400, 'type', 'Invalid type.'));
  //require userId
  if(!ctx.result.userId)
    return next(roda.error(400, 'userId', 'User missing.'));

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
  if(!ctx.result.dirty) return next();

  //handle local writes
  switch(ctx.result.type){
    case 'notebook':
    case 'tag':
      //notebook and tag sticky
      sticky('name');
    break;
    case 'note':
      //note sticky fields
      sticky('title', 'content', 'active', 'tagGuids', 'notebookGuid');
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
        ctx.result.tagGuids = [];
        ctx.result.tags.forEach(function(name){
          name = String(name);
          var key = name.toLowerCase();
          self.getBy('user_tag', [
            ctx.result.userId, key
          ], ctx.transaction, function(err, tag){
            if(tag){
              ctx.result.tagGuids.push(tag._id);
              return;
            }
            self.post({
              type: 'tag',
              userId: ctx.result.userId,
              name: name
            }, ctx.transaction, function(err, tag){
              if(tag) 
                ctx.result.tagGuids.push(tag._id);
            });
          });
        });
      }
      delete ctx.result.tags;
    break;
  }
  next();
});
