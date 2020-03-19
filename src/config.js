const path = require('path')

const config = {
  host: 'localhost',
  port: 8080,
  // root: process.cwd()
  root: path.resolve(__dirname, '..', 'public')
}
module.exports = config
