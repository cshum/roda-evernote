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

module.exports = function(roda, name){
  return roda(name)
    .use('validate', function(ctx, next){
      switch(ctx.result.type){
        case 'notebook':
        break;
        case 'note':
          if(!('active' in ctx.result)) 
            ctx.result.active = true; //default active

          //clean up
          delete ctx.result.contentHash;
          delete ctx.result.contentLength;
        break;
        case 'tag':
          // if(!TAG_REGEX.test(ctx.result.name))
          //   return next(roda.error(400, 'tagName', 'Invalid tag name.'));
          ctx.result.name = String(ctx.result.name).trim();
        break;
      }

      next();
    })
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
          if(!(field in ctx.result) && (field in ctx.current))
            ctx.result[field] = ctx.current[field];
        });
      }
    }, function(ctx){
      //dirty flag detection
      if(ctx.result && TYPE_SYNCABLE[ctx.result.type]){
        var newSeq = ctx.result.updateSequenceNum || 0;
        var currSeq = ctx.current ? (ctx.current.updateSequenceNum || 0) : 0;
        if( !newSeq || newSeq <= currSeq ){
          ctx.result.dirty = true;
          delete ctx.result.updateSequenceNum;

          switch(ctx.result.type){
            case 'note':
              //local timestamp
              if(!ctx.current) ctx.result.created = Date.now();
              else ctx.result.created = ctx.current.created;
              ctx.result.updated = Date.now(); 
              //content dirty detection
              if(!ctx.current || ctx.current.contentDirty || ctx.current.content !== ctx.result.content){
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
