# JW Ascolta

App web personale per riprodurre **cantici, canzoni e musica** dalla sezione [Musica di JW.org](https://www.jw.org/it/biblioteca-digitale/musica/).

**Live (Vercel):** https://jw-ascolta.vercel.app  
**Mirror (GitHub Pages):** https://andrew231716.github.io/jw-ascolta/  
**Repo:** https://github.com/Andrew231716/jw-ascolta

## Funzioni

- Riproduzione di **tutto** il catalogo audio musicale (italiano)
- Selezione di **una o più sezioni** insieme
- Modalità **casuale** o **in ordine**
- Controlli sulla schermata di blocco e **Now Playing CarPlay** (Media Session)
- **Tutti i comandi Siri in CarPlay** via `/api/carplay` (HLS + Apri URL)
- API `/api/play` (MP3), `/api/playlist` (HLS/M3U), `/api/carplay` (HLS)
- Installabile come PWA (Aggiungi a Home)

## Avvio

```bash
npm install
npm run dev
```

Poi apri l’URL mostrato da Vite (di solito `http://localhost:5173`).

Per la build di produzione:

```bash
npm run build
npm run preview
```

Per usare Siri da iPhone, l’app deve essere pubblicata su HTTPS (Netlify, Vercel, Cloudflare Pages, GitHub Pages, ecc.).

## Deep link / Siri

Parametri URL:

| Parametro | Valori | Descrizione |
|-----------|--------|-------------|
| `s` / `section` | `tutto`, `canzoni`, `musica-internazionale`, `adunanze`, `cantata`, `strumentale`, `corale`, `bambini`, `melodie`, `gnj1`, `gnj2`, `gnj3` (anche combinati con virgola) | Sezioni da riprodurre |
| `mode` | `shuffle` / `casuale` oppure `order` / `ordine` | Modalità |
| `title` / `t` / `brano` | testo del titolo | Parte da quel brano, poi continua con il resto della coda |
| `play` | `1` | Avvia subito |
| `siri` / `carplay` | `1` | UI compatta per avvio da comando / auto |

API:

| Percorso | Descrizione |
|----------|-------------|
| `/api/carplay?s=…&mode=…&title=…` | **HLS per CarPlay** — tutti i comandi Siri con Apri URL |
| `/api/play?title=…` | Redirect all’MP3 di un solo brano |
| `/api/playlist?s=…&mode=…&title=…` | Playlist HLS (default) o `format=m3u` |
| `/api/resolve?title=…` | JSON con URL audio e pageUrl |

### CarPlay (tutti i comandi)

Le web app non compaiono come icona CarPlay. Per avere **gli stessi comandi Siri in auto**, ogni Shortcut deve usare **Apri URL** verso `/api/carplay` (non la pagina web):

```
/api/carplay?s=canzoni&mode=shuffle
/api/carplay?s=tutto&mode=shuffle
/api/carplay?s=tutto&mode=shuffle&title=Sorgerà
```

L’iPhone riproduce la coda HLS; CarPlay mostra Now Playing.

Esempi:

```
/?s=canzoni&mode=shuffle&play=1
/?s=musica-internazionale&mode=shuffle&play=1
/?s=tutto&mode=shuffle&play=1
/?s=adunanze&mode=order&play=1
/?s=canzoni,bambini&mode=shuffle&play=1
/?s=canzoni&title=Sorgerà&mode=shuffle&play=1
```

Nella coda puoi **trascinare** i brani o usare **↑ ↓** per riordinarli a mano.

### Configurare Siri

1. Apri **Comandi** su iPhone
2. Nuovo comando → azione **Apri URL**
3. Incolla un URL come sopra (con il tuo dominio)
4. **Aggiungi a Siri** e registra ad esempio: «riproduci da JW canzoni»
5. In Safari: Condividi → **Aggiungi a Home**

Nell’app c’è anche la pagina **Comandi Siri** con esempi e copia URL.

## Nota

I file audio sono quelli pubblicati da JW.org. L’app è per **uso personale** e non è affiliata a Watch Tower Bible and Tract Society.
