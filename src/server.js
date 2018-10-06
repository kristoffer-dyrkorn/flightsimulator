// heavily based on Adrian Mejia's code, here:
// https://adrianmejia.com/blog/2016/08/24/building-a-node-js-static-file-server-files-over-http-using-es6/

const http = require("http")
const fs = require("fs")
const url = require("url")
const path = require("path")

const PORT = 8000
const INDEX_FILE = "index.html"

// map file extention to MIME types
const mimeTypes = {
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png"
}

http
  .createServer(function(req, res) {
    console.log(`${req.method} ${req.url}`)

    // parse URL
    const parsedUrl = url.parse(req.url)

    // extract URL path
    let pathname = `.${parsedUrl.pathname}`

    fs.exists(pathname, function(exist) {
      if (!exist) {
        // if the file is not found, return 404
        res.statusCode = 404
        res.end(`HTTP error 404: Page not found`)
        return
      }

      // if is a directory search for index file
      if (fs.statSync(pathname).isDirectory()) pathname = pathname + INDEX_FILE

      // based on the URL path, extract the file extention. e.g. .js, .doc, ...
      const fileExtension = path.parse(pathname).ext

      // read file from file system
      fs.readFile(pathname, function(err, data) {
        if (err) {
          res.statusCode = 500
          res.end(`HTTP Error 500: Internal server error. ${err}.`)
        } else {
          // if the file is found, set Content-type and send data
          res.setHeader("Content-type", mimeTypes[fileExtension] || "text/plain")
          res.end(data)
        }
      })
    })
  })
  .listen(PORT)

console.log(`Server listening on port ${PORT}`)
