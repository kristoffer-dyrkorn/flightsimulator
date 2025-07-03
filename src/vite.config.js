import { defineConfig } from "vite"

export default defineConfig({
  server: {
    port: 8000,
    open: "?local",
  },
  plugins: [
    {
      name: "requestLogger",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          console.log(`${req.method} ${req.url}`)
          next()
        })
      },
    },
  ],
})
