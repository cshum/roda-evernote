var rodabase = require('rodabase'),
    evernote = require('../'),
    express  = require('express'),
    rest     = require('roda-rest');

var roda = rodabase('./db');
var resources = require('fs-blob-store')('./resources');
var ever = evernote(roda('evernote'), { resources: resources });

var app = express();
app.get('/api/sync/:token', function(req, res){
  ever.sync(req.params.token, function(err, state){
    res.redirect('/api/evernote');
  });
});
app.use('/api', rest(roda)); //roda rest api
app.use('/resources/:userId/:hash', function(req, res, next){
  resources.createReadStream({ key: req.params.userId + '/' + req.params.hash })
    .on('error', next)
    .pipe(res);
}); 
app.use(function(err, req, res, next){
  res.json(err);
});
app.listen(3000);
console.log('roda-evernote is listening on port '+ 3000);
