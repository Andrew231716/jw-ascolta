import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'JW Ascolta',
        short_name: 'JW Ascolta',
        description:
          'Riproduci cantici, canzoni e musica JW.org in ordine o a caso, anche con Siri.',
        theme_color: '#0c2429',
        background_color: '#0c2429',
        display: 'standalone',
        start_url: '/',
        lang: 'it',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
