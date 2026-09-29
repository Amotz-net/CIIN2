# Local preview of the role screens

For checking layout without signing in. It answers database reads from
`fixture.js` (made-up rows shaped like the real ones) and records writes
instead of sending them. Satellite and regional feeds are real.

    npx vite --port 5180
    open http://localhost:5180/dev-preview/index.html?v=hotel

`v` is one of: command, admin, gov, hotel, hub, buyer, lab, props.
Not part of the built site.
