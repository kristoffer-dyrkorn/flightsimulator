import { defineConfig } from "vite"

export default defineConfig({
  server: {
    port: 8000,
    open: "?local",
  },
  // comment out when running locally
  base: "/flightsimulator/",
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
