# Magical Athlete — online

A browser version of the Magical Athlete board game for playing with friends over the internet.
Nothing is enforced: you read the cards, roll the dice, and move the pawns yourselves. The site keeps
everyone in sync, runs the draft, tracks turns and scores, and lets you scribble on the board.

## Try it right now (no setup)

Open `index.html` through any local web server and it runs in **local test mode**: everything is stored
in your browser, and each tab you open can be a different player. Good for poking around.

Easiest server on Windows with Node installed:

```bash
npx serve .
```

## Play online with friends (about 10 minutes)

1. Make a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard open **SQL Editor → New query**, paste all of `setup.sql`, and click **Run**.
   You can reuse the Liar's Dice project — the tables here are all prefixed `ma_`.
3. Open **Settings → API** and copy the **Project URL** and the **anon / publishable key**.
4. Paste them into `js/config.js`.
5. Upload the folder to any static host (GitHub Pages, Netlify drop, etc.) and share the link.

## How a tournament goes

1. **Lobby** — host picks the board, the card sets, number of races, and so on. Players pick colors and
   reorder themselves (that's the turn order). "Copy invite link" gives friends a link with the code filled in.
2. **Draft** — snake order. Click a card to read it, then draft it. With "Players create them" turned on,
   everyone first invents their own racers (name, ability, emoji, and a little drawn portrait).
3. **Lineup** — if you own more than one racer, choose which one runs.
4. **Race** — roll, then click or drag your pawn. Anyone can move any pawn so abilities that push other racers
   are easy to resolve. Board squares (ladders, chutes, ⭐ point squares, 🍌 trip squares) apply themselves.
   Undo reverses the last move. Drop a pawn on GOAL to record its place.
5. **Results** — host confirms (and can edit) the points, then the next race or draft begins.

Extras: dark mode, chat in the log, board drawing with host mute, keyboard shortcuts (R roll, N end turn,
U undo, D draw), "Flip a random card" for abilities that need one, and rejoining from a new device by
entering the lobby code.

## Editing cards and boards

- **`js/cards.js`** — every card lives here. The official 30 were written from memory: check them against
  your box and fix the `text` field. `EXPERIMENTAL_CARDS` holds 80 new characters; `CUSTOM_CARDS` is for yours.
- **`js/boards.js`** — boards are a list of waypoints the path curves through plus a `specials` map.
  Copy a board, rename it, and it shows up in the lobby (experimental ones sit behind the toggle).

## Files

| File | What it does |
| --- | --- |
| `index.html` | Create or join a lobby |
| `game.html` + `js/game.js` | Lobby, card creation, draft, race, results |
| `js/client.js` | Shared helpers and the Supabase / local-mode storage layer |
| `js/cards.js`, `js/boards.js` | Content |
| `css/style.css` | Styling, including dark mode |
| `setup.sql` | Supabase tables and the `ma_apply` function that keeps edits from clobbering each other |
