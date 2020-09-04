datatables-websocket
====================

Websocket-datalähdetoteutus jQuery-dataTables-vimpaimelle

Asennus, HTML
-------------
```html
<script type="text/javascript" src="jquery-3.3.1.min.js"></script>
<script type="text/javascript" src="datatables.min.js"></script>
<script type="text/javascript" src="datatables.websocket.js"></script>
```
Käyttöönotto, Javascript
------------------------
```javascript
$(...).DataTable({
  ajax: {
    type: "Websocket",
    url: "wss://...",
    // Tarvittaessa:
    data: ...,
    traditional: true
  },
  ...
});
```
Websocket-yhteys avataan automaattisesti datataulun alustuksen yhteydessä ja avaamista yritetään uudelleen, jos yhteys katkeaa.

Mahdolliset virhetilanteet ilmaistaan käyttäjälle samoin kuin Ajax-pyyntöjen yhteydessäkin; ks. `$.fn.dataTable.ext.errMode`-asetus.

Viestiliikenne
--------------

Viestiliikenne Websocket-yhteyden kautta noudattaa Ajax-tiedonsiirtokäytäntöä palvelimen ja selaimen välillä, ks. https://datatables.net/manual/server-side

Lähtevät ja saapuvat sanomat ovat tekstimuotoisia ja noudattavat seuraavaa protokollaa:
* selain -> palvelin: yhteen tietopyyntöön liittyvät GET-parametrit URL-koodatussa muodossa, esim.
  ```
  "draw=1&columns[x][data]=y&...&start=z&length=w&search[value]=s&..."
  ```
* palvelin -> selain: yhteen tietopyyntöön liittyvä aineisto JSON-muodossa, esim.
  ```json
  {"draw": 1, "recordsTotal": 12, "recordsFiltered": 7, "data": [{"DT_RowAttr": {...}}]}
  ```
Palvelimen sopii ilmoittaa mahdollisesta virhetilanteesta pyynnön käsittelyssä `error`-avaimen kautta.
