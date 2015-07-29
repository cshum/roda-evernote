var test     = require('tape'),
    rodabase = require('rodabase'),
    memdown  = require('memdown'),
    evernote = require('../'),
    H        = require('highland');

var roda = rodabase('./db', {db: memdown});
var store = roda('evernote');
var ever = evernote(roda, 'evernote');
var tokens = require('./tokens.json');

tokens.forEach(function(token){
  var userId;
  var seq = 0;
  var defaultNotebookGuid;
  test('Full sync', function(t){
    var typeSeq = {};
    var stream = store.liveStream().reject(function(doc){
      if(!userId)
        userId = doc.userId;
      return doc.type === 'meta';
    }).each(function(doc){
      t.ok(doc.updateSequenceNum > (typeSeq[doc.type] || 0), 'Type Seq incremental');
      t.equal(doc.userId, userId, 'userId');
      t.ok(!!doc.guid && !!doc.type, 'Has type and guid');
      seq = doc.updateSequenceNum;
      if(doc.defaultNotebook)
        defaultNotebookGuid  = doc.guid;
      typeSeq[doc.type] = seq;
    });
    ever.sync(token, function(err){
      t.notOk(err, 'Sync no error');
      stream.destroy();
      store.get(userId, function(err, meta){
        t.ok(meta.lastUpdateCount >= seq, 'lastUpdateCount >= seq');
        seq = meta.lastUpdateCount;
        t.equal(meta.defaultNotebookGuid, defaultNotebookGuid, 'defaultNotebookGuid');
        t.end();
      });
    });
  });
  var noteGuid;
  var content = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM '+
    '"http://xml.evernote.com/pub/enml2.dtd"><en-note>'+
    '<span style="font-weight:bold;">Content '+(new Date())+'.</span></en-note>';
  test('Create note', function(t){
    var ts = Date.now();
    store.post({
      type: 'note',
      userId: userId,
      title: "Create "+(new Date()),
      content: content
    }, function(err, doc){
      t.ok(doc.dirty, 'Dirty flag');
      t.ok(doc.contentDirty, 'Content dirty flag');
      t.ok(doc.created > ts, 'Created timestamp');
      t.ok(doc.updated > ts, 'Updated timestamp');
      t.ok(doc.active, 'Active');
      t.equal(doc.notebookGuid, defaultNotebookGuid, 'defaultNotebookGuid');
      t.notOk(doc.deleted, 'No deleted timestamp');
      store.liveStream().reject(function(doc){
        return doc.type === 'meta';
      }).take(2).toArray(function(list){
        var link = list[0];
        var doc = list[1];
        //link
        t.equal(link.type, 'link', 'Link');
        t.equal(link.link, doc.guid, 'Link and doc guid');
        //doc
        noteGuid = doc.guid;
        t.notOk(doc.dirty, 'Not dirty after sync');
        t.notOk(doc.contentDirty, 'Not content dirty after sync');
        t.equal(doc.type, 'note', 'Note type');
        t.equal(doc.userId, userId, 'userId');
        t.equal(doc.content, content, 'content');
        t.equal(doc.notebookGuid, defaultNotebookGuid, 'defaultNotebookGuid');
        t.ok(doc.updateSequenceNum > seq, 'Seq incremental');
        t.ok(doc.active, 'Active');
        seq = doc.updateSequenceNum;
        store.get(userId, function(err, doc){
          t.ok(doc.lastUpdateCount >= seq, 'lastUpdateCount >= seq');
          seq = doc.lastUpdateCount;
          t.end();
        });
      });
      ever.sync(token, function(err){
        t.notOk(err, 'Sync no error');
      });
    });
  });
  test('Update note', function(t){
    var tx;
    var ts = Date.now();
    tx = roda.transaction();
    store.put(noteGuid, {
      title: 'Dummy '+(new Date()),
      content: content
    }, tx); //dummy put
    store.put(noteGuid, {
      title: 'Update '+(new Date()),
      content: content
    }, tx, function(err, doc){
      t.equal(doc.type, 'note', 'Note type');
      t.equal(doc.userId, userId, 'userId');
      t.equal(doc.guid, noteGuid, 'Doc guid');
      t.ok(doc.dirty, 'Dirty flag');
      t.notOk(doc.contentDirty, 'Not content dirty');
      t.ok(doc.updated > ts, 'Updated timestamp');
      t.ok(doc.active, 'Active');
      t.notOk(doc.deleted, 'No deleted timestamp');
    });
    tx.commit(function(err){
      store.liveStream().reject(function(doc){
        return doc.type === 'meta';
      }).pull(function(err, doc){
        t.equal(doc.guid, noteGuid, 'Doc guid');
        t.notOk(doc.dirty, 'Not dirty after sync');
        t.notOk(doc.contentDirty, 'Not content dirty after sync');
        t.equal(doc.type, 'note', 'Note type');
        t.equal(doc.userId, userId, 'userId');
        t.equal(doc.content, content, 'content');
        t.ok(doc.updateSequenceNum > seq, 'Seq incremental');
        t.ok(doc.active, 'Active');
        seq = doc.updateSequenceNum;
        store.get(userId, function(err, doc){
          t.ok(doc.lastUpdateCount >= seq, 'lastUpdateCount >= seq');
          seq = doc.lastUpdateCount;
          t.end();
        });
      });
      ever.sync(token, function(err){
        t.notOk(err, 'Sync no error');
      });
    });
  });
  test('Update note content', function(t){
    var tx;
    var ts = Date.now();
    var content2 = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM '+
      '"http://xml.evernote.com/pub/enml2.dtd"><en-note>'+
      '<span style="font-weight:bold;">Content2 '+(new Date())+'.</span></en-note>';
    tx = roda.transaction();
    store.put(noteGuid, {
      title: 'Dummy'+(new Date()),
      content: content2
    }, tx); //dummy put
    store.put(noteGuid, {
      title: 'Update Content '+(new Date()),
      content: content2
    }, tx, function(err, doc){
      t.equal(doc.type, 'note', 'Note type');
      t.equal(doc.userId, userId, 'userId');
      t.equal(doc.guid, noteGuid, 'Doc guid');
      t.ok(doc.dirty, 'Dirty flag');
      t.ok(doc.contentDirty, 'Content dirty');
      t.ok(doc.updated > ts, 'Updated timestamp');
      t.ok(doc.active, 'Active');
      t.notOk(doc.deleted, 'No deleted timestamp');
    });
    tx.commit(function(err){
      store.liveStream().reject(function(doc){
        return doc.type === 'meta';
      }).pull(function(err, doc){
        t.equal(doc.guid, noteGuid, 'Doc guid');
        t.notOk(doc.dirty, 'Not dirty after sync');
        t.notOk(doc.contentDirty, 'Not content dirty after sync');
        t.equal(doc.type, 'note', 'Note type');
        t.equal(doc.userId, userId, 'userId');
        t.equal(doc.content, content2, 'content');
        t.ok(doc.updateSequenceNum > seq, 'Seq incremental');
        t.ok(doc.active, 'Active');
        seq = doc.updateSequenceNum;
        store.get(userId, function(err, doc){
          t.ok(doc.lastUpdateCount >= seq, 'lastUpdateCount >= seq');
          seq = doc.lastUpdateCount;
          t.end();
        });
      });
      ever.sync(token, function(err){
        t.notOk(err, 'Sync no error');
      });
    });
  });
  test('Trash note', function(t){
    var ts = Date.now();
    store.put(noteGuid, {
      active: false
    }, function(err, doc){
      t.equal(doc.type, 'note', 'Note type');
      t.equal(doc.userId, userId, 'userId');
      t.equal(doc.guid, noteGuid, 'Doc guid');
      t.ok(doc.title, 'Has title');
      t.ok(doc.content, 'Has content');
      t.ok(doc.dirty, 'Dirty flag');
      t.notOk(doc.contentDirty, 'Not content dirty');
      t.ok(doc.deleted > ts, 'Deleted timestamp');
      t.notOk(doc.active, 'Not active');
      store.liveStream().reject(function(doc){
        return doc.type === 'meta';
      }).pull(function(err, doc){
        t.equal(doc.type, 'note', 'Note type');
        t.equal(doc.userId, userId, 'userId');
        t.notOk(doc.dirty, 'Not dirty after sync');
        t.notOk(doc.contentDirty, 'Not content dirty after sync');
        t.ok(doc.deleted, 'Deleted timestamp');
        t.notOk(doc.active, 'Not active');
        seq = doc.updateSequenceNum;
        store.get(userId, function(err, doc){
          t.ok(doc.lastUpdateCount >= seq, 'lastUpdateCount >= seq');
          seq = doc.lastUpdateCount;
          t.end();
        });
      });
      ever.sync(token, function(err){
        t.notOk(err, 'Sync no error');
      });
    });
  });
  /*
  test('Incremental Sync', function(t){
    //create/update note from another client then sync
  });
  test('Tag Conflict', function(t){

  });
  */
});

