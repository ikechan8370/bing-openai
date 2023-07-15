var express = require('express');
const {chat} = require("../src/OpenAIInterface");
var router = express.Router();

/* GET users listing. */
router.post('/', async function(req, res, next) {
  let body = req.body
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  console.log(JSON.stringify(body))
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders()
    const onData = (data) => {
      // console.log(data)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    chat(body, onData).then(() => {
      res.write(`data: [DONE]\n\n`)
      res.end()
    }).catch(err => {
      res.write(JSON.stringify({
        error: err
      }))
      res.end()
    })
  } else {
    let result = await chat(body)
    res.send(result);
  }

});

module.exports = router;
