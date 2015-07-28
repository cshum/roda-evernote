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
    .use('diff', function(ctx, next){
      //create
      if(!ctx.current && ctx.result){
        if(!(ctx.result.type in TYPE_SYNCABLE))
          return next(roda.error(400, 'type', 'Invalid type.'));
        //require userId
        if(!ctx.result.userId)
          return next(roda.error(400, 'userId', 'User missing.'));
      }
      next();
    }, function(ctx){
      if(ctx.current && ctx.result){
        //const
        ctx.result.userId = ctx.current.userId;
        //sticky
        ['type', 'guid'].forEach(function(field){
          if(!(field in ctx.result) && ctx.current && field in ctx.current)
            ctx.result[field] = ctx.current[field];
        });
      }
    }, function(ctx){
      var self = this;
      //dirty flag detection
      if(ctx.result && TYPE_SYNCABLE[ctx.result.type]){
        var newSeq = ctx.result.updateSequenceNum || 0;
        var currSeq = ctx.current ? (ctx.current.updateSequenceNum || 0) : 0;
        if( !newSeq || newSeq <= currSeq ){
          ctx.result.dirty = true;
          delete ctx.result.updateSequenceNum;

          switch(ctx.result.type){
            case 'note':
              //sticky
              ['title', 'content', 'active', 'tagGuids', 'notebookGuid'].forEach(function(field){
                if(!(field in ctx.result) && ctx.current && field in ctx.current)
                  ctx.result[field] = ctx.current[field];
              });
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

              //todo: tags handling
              if(Array.isArray(ctx.result.tags)){
                var tags = ctx.result.tags;
                // tags.forEach(function(name){
                // });
              }
              delete ctx.result.tags;

              //content dirty detection
              if(!ctx.current || ctx.current.contentDirty || 
                 ctx.current.content !== ctx.result.content){
                ctx.result.contentDirty = true;
              }
            break;
          }
        }
      }
    })
    .registerIndex('user_seq', function(doc, emit){
      if(doc.updateSequenceNum) 
        emit([doc.userId, doc.updateSequenceNum], true);
    })
    .registerIndex('user_tags', function(doc, emit){
      if(doc.type === 'tag') 
        emit([doc.userId, doc.name.toLowerCase()], true); 
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
    .registerIndex('notes', function(doc, emit){
      if(doc.type === 'note' && doc.active)
        emit(doc.updated); 
    })
    .rebuildIndex(1);
};
