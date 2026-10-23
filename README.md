# JW Ascolta

App web personale per riprodurre **cantici, canzoni e musica** dalla sezione [Musica di JW.org](https://www.jw.org/it/biblioteca-digitale/musica/).

**Live:** https://andrew231716.github.io/jw-ascolta/  
**Repo:** https://github.com/Andrew231716/jw-ascolta

## Funzioni

- Riproduzione di **tutto** il catalogo audio musicale (italiano)
- Selezione di **una o più sezioni** insieme
- Modalità **casuale** o **in ordine**
- Controlli sulla schermata di blocco (Media Session)
- **Deep link** per Siri / Comandi iOS
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
| `play` | `1` | Avvia subito |

Esempi:

```
/?s=canzoni&mode=shuffle&play=1
/?s=musica-internazionale&mode=shuffle&play=1
/?s=tutto&mode=shuffle&play=1
/?s=adunanze&mode=order&play=1
/?s=canzoni,bambini&mode=shuffle&play=1
```

### Configurare Siri

1. Apri **Comandi** su iPhone
2. Nuovo comando → azione **Apri URL**
3. Incolla un URL come sopra (con il tuo dominio)
4. **Aggiungi a Siri** e registra ad esempio: «riproduci da JW canzoni»
5. In Safari: Condividi → **Aggiungi a Home**

Nell’app c’è anche la pagina **Comandi Siri** con esempi e copia URL.

## Nota

I file audio sono quelli pubblicati da JW.org. L’app è per **uso personale** e non è affiliata a Watch Tower Bible and Tract Society.
