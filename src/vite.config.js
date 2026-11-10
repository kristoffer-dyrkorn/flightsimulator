import { defineConfig } from "vite"

export default defineConfig(({ command }) => ({
  server: {
    port: 8000,
    open: "?local",
  },
  // base folder for the app depends on local build / prod build
  base: command === "build" ? "/flightsimulator/" : "/",
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
}))
