const config = require('./config')
const chalk = require('chalk')
const http = require('http')
const path = require('path')
const url = require('url')
const fs = require('fs')
const mime = require('mime')
const zlib = require('zlib')
const crypto = require('crypto')
const handlebars = require('handlebars')

const { promisify, inspect } = require('util')
const stat = promisify(fs.stat)
const readdir = promisify(fs.readdir)

// 编译模板，得到一个渲染的方法，然后传入实际的数据就可以得到渲染后的 HTML 了
function list() {
  const tmp = fs.readFileSync(
    path.resolve(__dirname, 'template', 'list.html'),
    'utf8'
  )
  return handlebars.compile(tmp)
}

// 设置环境变量
// process.env.DEBUG = 'static:app'

// 每个 debug 实例都有一个名字，是否在控制台打印，取决于环境变量中 DEBUG 的值是否等于 static:app
// static:app 有个约定俗成，有两部分组成，第一个是项目名，第二个是模块名
// windows 下面是 set DEBUF=static:app  set 是 window 下面特有的设置环境变量的命令
// mac liunx 是 export DEBUF=static:app
const debug = require('debug')('static:app')

/**
 * 新增几个功能
 * 1：显示目录下面的文件列表和返回内容
 * 2：实现压缩功能
 */

class Server {
  constructor(argv) {
    this.list = list()
    this.config = Object.assign({}, config, argv)
    debug(this.config)
  }
  start() {
    const server = http.createServer()
    server.on('request', this.request.bind(this))
    server.listen(this.config.port, _ => {
      const url = `http://${this.config.host}:${this.config.port}`
      // debug(`Server started at ${chalk.green(url)}`)
      console.log(`Server started at ${chalk.green(url)}`)
    })
  }
  // 静态文件服务器
  async request(req, res) {
    // 先取到客户端想要的文件或者文件路径
    const { pathname } = url.parse(req.url)
    if (pathname === '/favicon.ico') {
      return this.sendError('/favicon.ico not found', req, res)
    }
    const filepath = path.join(this.config.root, pathname)
    try {
      const statObj = await stat(filepath)
      // 如果是目录那么显示目录下面的文件列表
      if (statObj.isDirectory()) {
        // 如果是文件夹要显示所有文件列表，所以需要写模板，模板我们选择 handlerbar 插件
        const files = await readdir(filepath), list = [];
        for (let i = 0, len = files.length; i < len; i++) {
          const file = files[i]
          const fullName = path.resolve(filepath, file)
          const _stat = await stat(fullName)
          list.push({
            name: file,
            url: path.join(pathname, file),
            isDir: _stat.isDirectory()
          })
        }
        const html = this.list({
          title: pathname + ' | 静态服务器',
          list
        })
        res.setHeader('Content-Type', 'text/html')
        res.end(html)
      } else {
        this.sendFile(req, res, filepath, statObj)
      }
    } catch (error) {
      // 把对象转成字符串
      debug(inspect(error))
      this.sendError(error, req, res)
    }
  }
  async sendFile(req, res, filepath, statObj) {
    try {
      // 如果走缓存，就不处理了
      if (await this.dealCache(req, res, filepath, statObj)) return
      res.setHeader('Content-Type', mime.getType(filepath) + ';charset=utf-8')
      const encoding = this.getEncoding(req, res)
      if (encoding) {
        fs.createReadStream(filepath)
          .pipe(encoding)
          .pipe(res)
      } else {
        fs.createReadStream(filepath).pipe(res)
      }
    } catch (error) {
      this.sendError(error, req, res)
    }
  }
  dealEtag(req, res, filepath) {
    return new Promise((resolve, reject) => {
      const md5 = crypto.createHash('md5')
      const rs = fs.createReadStream(filepath)
      // 要先写入响应头在写入响应体
      rs.on('data', chunk => {
        md5.update(chunk)
      })
      rs.on('end', () => {
        const etag = md5.digest('base64')
        res.setHeader('Etag', etag)
        resolve(etag)
      })
    })
  }
  dealLastModified(req, res, statObj) {
    const lastModified = statObj.ctime.toGMTString()
    res.setHeader('Last-Modified', lastModified)
    return lastModified
  }
  // 处理缓存
  async dealCache(req, res, filepath, statObj) {
    try {
      const etag = await this.dealEtag(req, res, filepath)
      const lastModified = this.dealLastModified(req, res, statObj)
      const ifModifiedSince = req.headers['if-modified-since']
      const ifNoneMacth = req.headers['if-none-match']
      res.setHeader('Cache-Control', 'private,max-age=30')
      res.setHeader('Expires', new Date(Date.now() + 30 * 1000))
      // res.setHeader('Expires', new Date(Date.now() + 30 * 1000).toGMTString())
      if ((ifNoneMacth && ifNoneMacth === etag) || (ifModifiedSince && ifModifiedSince === lastModified)) {
        console.log('缓存？')
        // 协商缓存
        res.writeHead(304)
        res.end()
        return Promise.resolve(true)
      }
      return Promise.resolve(false)
    } catch (error) {
      this.sendError(error, req, res)
    }
  }
  getEncoding(req, res) {
    // Accept-Encoding: gzip, deflate
    const acceptEncoding = req.headers['accept-encoding']
    if (/\bgzip\b/.test(acceptEncoding)) {
      // 需要告诉客户端服务端压缩过了，不然浏览器不会解压
      res.setHeader('Content-Encoding', 'gzip')
      return zlib.createGzip()
    } else if (/\bdeflate\b/.test(acceptEncoding)) {
      res.setHeader('Content-Encoding', 'deflate')
      return zlib.createDeflate()
    } else {
      return null
    }
  }
  sendError(err, req, res) {
    res.statusCode = 500
    console.log('sendError', err)
    res.end(`There is something wrong in the server! place try later`)
  }
}

// const server = new Server()
// server.start()

module.exports = Server
