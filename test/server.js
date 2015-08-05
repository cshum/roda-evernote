var rodabase = require('rodabase'),
    evernote = require('../'),
    express  = require('express'),
    rest     = require('roda-rest');

var roda = rodabase('./db');
var blobs = require('fs-blob-store')('./blobs');
var ever = evernote(roda('evernote'), { blobs: blobs });

var app = express();
app.get('/api/sync/:token', function(req, res){
  ever.sync(req.params.token, function(err, state){
    res.redirect('/api/evernote');
  });
});
app.use('/api', rest(roda)); //roda rest api
app.use('/blobs/:key', function(req, res, next){
  blobs.createReadStream({ key: req.params.key })
    .on('error', next)
    .pipe(res);
}); 
app.use(function(err, req, res, next){
  res.json(err);
});
app.listen(3000);
console.log('roda-evernote is listening on port '+ 3000);
