var express = require('express');
const {chat} = require("../src/OpenAIInterface");
var router = express.Router();

/* GET users listing. */
router.post('/', async function(req, res, next) {
  let result = await chat(req.body)
  res.send(result);
});

module.exports = router;
