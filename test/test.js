var test     = require('tape'),
    rodabase = require('rodabase'),
    memdown  = require('memdown'),
    evernote = require('../'),
    H        = require('highland'),
    rest     = require('roda-rest');

var roda = rodabase('./db', {db: memdown});
var store = roda('evernote');
var ever = evernote(roda, 'evernote');
var tokens = require('./tokens.json');

tokens.forEach(function(token){
  test('Full Sync', function(t){
    var seq = 0;
    var typeSeq = {};
    var userId;
    var stream = store.liveStream().reject(function(doc){
      userId = doc.userId;
      return doc.type === 'meta';
    }).each(function(doc){
      t.ok(doc.updateSequenceNum > (typeSeq[doc.type] || 0), 'Type Seq incremental');
      t.equal(doc.userId, userId, 'userId');
      t.ok(!!doc.guid && !!doc.type, 'Has type and guid');
      seq = doc.updateSequenceNum;
      typeSeq[doc.type] = seq;
    });
    ever.sync(token, function(err){
      t.notOk(err, 'No error');
      stream.destroy();
      store.get(userId, function(err, doc){
        t.equal(doc.lastUpdateCount, seq, 'lastUpdateCount');
        t.end();
      });
    });
  });
});

