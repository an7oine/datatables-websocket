/*
 * Websocket-datayhteyden toteutus jQuery-dataTables-vimpaimeen.
 *
 * Käyttöönotto tehdään asettamalla datataulun asetusten arvot
 * `ajax.type: "Websocket"` ja `ajax.url: "wss://palvelin/polku"`.
 *
 * Yhteys muodostetaan vain kerran kutakin datataulua kohti
 * ja saman yhteyden kautta toteutetaan kaikki taulun tekemät
 * datapyynnöt. Kukin palvelimelta saatu vastaus yhdistetään
 * pyyntöön sen sisältämän `draw`-avaimen arvon perusteella.
 *
 * Vain viimeisin pyyntö huomioidaan, muut mahdolliset paluusanomat ohitetaan.
 *
 * Samoin ohitetaan paluusanomat, jotka eivät sisällä avainta `draw`.
 *
 * Paluusanoma, joka ei ole JSON-muodossa, aihettaa virheilmoituksen.
 *
 * Mahdolliset palvelimen omasta aloitteestaan lähettämät reaaliaikaiset
 * sanomat tunnistetaan `draw`-avaimen arvosta `0`. Tällöin datataulu
 * päivitetään automaattisesti vastaamaan annettua dataa.
 *
 * Mikäli Websocket-yhteys katkeaa, sen uudelleen muodostamista
 * yritetään automaattisesti uudelleen pienellä viiveellä.
 */

(function ($) {
  // Ota laajennus käyttöön automaattisesti datataulun alustuksen yhtey-
  // dessä silloin, kun Ajax-tietolähteeksi on määritetty "Websocket".
  $(document).on("preInit.dt.dtr", function (e, settings, json) {
    if (
      e.namespace === 'dt'
      && "ajax" in settings
      && typeof settings.ajax === "object"
      && "type" in settings.ajax
      && settings.ajax.type == "Websocket"
      && "url" in settings.ajax
      && ! settings._websocket
    )
      settings._websocket = new DTWebsocket(settings);
  });

  var DTWebsocket = function (settings, opts) {
    // Hae alustettava datatauluolio.
    this.datatable = new $.fn.DataTable.Api(settings);
    this.dtSettings = settings;

    // Alusta yhteyden parametrit ja konteksti.
    this.url = settings.ajax.url;
    this.traditional = settings.ajax.traditional;
    this.websocket = null;
    this.viestijono = null;

    // Alusta Ajax-datafunktio joko annettuna funktiona
    // tai uutena funktiona, joka yhdistää annetun, kiinteän
    // dataobjektin pyyntökohtaiseen;
    // vrt. `jquery.dataTables.js`, funktio `_fnBuildAjax`.
    var ajaxData = settings.ajax.data;
    if (typeof ajaxData !== "function")
      this.ajaxData = function (data, settings) {
        return $.extend(true, data, ajaxData);
      };
    else
      this.ajaxData = ajaxData;

    // Aseta Ajax-datapyyntöjen käsittelyfunktio.
    settings.ajax = function (data, callback, settings) {
      settings._websocket.pyynto(data, callback, settings);
    };

    // Avaa WS-yhteys.
    this.avaaYhteys();
  };

  $.extend(DTWebsocket.prototype, {
    dtKutsu: function (funktio, parametrit) {
      // Kutsu nimettyä sisäistä DT-funktiota annetuin parametrein.
      return $.fn.DataTable.ext.internal[funktio].apply(
        this.datatable, parametrit
      );
    },

    avaaYhteys: function () {
      // Avaa yhteys `ajax.url`-asetuksen mukaiseen osoitteeseen.
      this.websocket = new WebSocket(this.url);

      // Tuhoa mahdollinen aiempi viestijono.
      this.viestijono = null;

      // Aseta WS-yhteyden paluukutsut.
      var _this = this;
      $.extend(this.websocket, {
        onopen: function (e) { _this.yhteysAvattu(e); },
        onclose: function (e) { _this.yhteysSuljettu(e); },
        onerror: function (e) { _this.yhteysvirhe(e); },
        onmessage: function (e) { _this.vastaus(e); }
      });
    },

    yhteysAvattu: function (e) {
      // Ensimmäisellä kerralla yhteyden muodostuksen jälkeen
      // alustetaan viestijono.
      if (this.viestijono === null) {
        this.viestijono = {};
      }
    },

    yhteysSuljettu: function (e) {
      // Kun yhteys palvelimeen katkeaa, anna virheilmoitus
      // ja yritä hetken kuluttua uudelleen.
      if (this.viestijono) {
        var pyynto = Object.values(this.viestijono)[0];
        if (pyynto) {
          delete this.viestijono[pyynto.draw];
        }
      }
      var _this = this;
      if (e.code > 1001)
        setTimeout(function () { _this.avaaYhteys(); }, 200);
    },

    yhteysvirhe: function (e) {
      this.dtKutsu("_fnCallbackFire", [
        this.dtSettings, null, "xhr", [
          this.dtSettings, null, this.dtSettings.jqXHR
        ]
      ]);
      if (this.viestijono) {
        var pyynto = Object.values(this.viestijono)[0];
        if (pyynto) {
          this.dtKutsu("_fnLog", [
            this.dtSettings, 0, "Virhe palvelinyhteydessä", 7
          ]);
          delete this.viestijono[pyynto.draw];
        }
      }
    },

    pyyntodata: function (data, settings) {
      // Sarjallista data tarvittaessa merkkijonoksi.
      // vrt. jQuery; `src/ajax.js`, funktio `ajax`.
      data = this.ajaxData(data, settings);
      if (data && typeof data !== "string")
        data = $.param(data, this.traditional);
      // Korvataan `_fnBuildAjax`-funktion asettama `oAjaxData`
      // asetusten mukaisesti täydennetyllä datalla.
      // Lisäksi suoritetaan mahdolliset `preXhr`-paluukutsut
      // uudelleen tällä täydennetyllä datalla.
      settings.oAjaxData = data;
      this.dtKutsu("_fnCallbackFire", [
        this.dtSettings, null, "preXhr", [
          this.dtSettings, data
        ]
      ]);
      return data;
    },

    pyynto: function (data, callback, settings) {
      // Mikäli Websocket-yhteys ei ole vielä valmis, odotetaan.
      if (! this.viestijono)
        return;

      var _this = this;
      var _callback = function(data) {
        // Kääri paluukutsu uuteen funktioon,
        // joka suorittaa ensin mahdolliset `xhr`-paluukutsut.
        // Vrt. `jquery.dataTables.js`, funktio `_fnBuildAjax`,
        // sisempi funktio `baseAjax.success`.
        if ("error" in data)
          // Virhe datapyynnön käsittelyssä: ilmoita.
          _this.dtKutsu("_fnLog", [
            _this.dtSettings, 0, data.error
          ]);
        _this.dtSettings.json = data;
        callback(data);
      }

      // Poimi datatableksen asettama pyynnön tunniste.
      var draw = data.draw;

      // Muodostetaan todellinen lähtevä dataolio täydennettynä
      // mahdollisisilla `settings.ajax.data`-parametreillä,
      // Homaa, että funktio myös korvaa Datatableksen asettaman,
      // puutteellisen `settings.oAjaxData`-määreen.
      data = this.pyyntodata(data, settings);
      if (this.reaaliaikainen_sanoma)
        // Käytä ensisijaisesti mahdollista palvelimen jo lähettämää,
        // reaaliaikaista sanomaa.
        _callback($.extend(
          true, this.reaaliaikainen_sanoma, {draw: draw}
        ));

      else {
        // Tyhjennetään mahdolliset aiemmat, edelleen käynnissä
        // olevat pyynnöt. Jäädään odottamaan paluusanomaa.
        this.viestijono = {[draw]: _callback};

        // Lähetetään pyyntödata URL-koodattuna merkkijonona.
        this.websocket.send(data);
      }
    },

    vastaus: function (e) {
      try {
        var sanoma = JSON.parse(e.data);
      } catch (error) {
        // Sanoma ei ole JSON-muodossa; ilmoitetaan virheestä
        // ja ohitetaan kaikki käsittely.
        return this.dtKutsu("_fnLog", [
          this.dtSettings, 0, "Virheellinen sanoma", 1
        ]);
      }

      // Vain `draw`-avaimen sisältävät sanomat
      // käsitellään tässä.
      if ("draw" in sanoma) {
        if (sanoma.draw === 0) {
          // Reaaliaikainen sanoma; tallenna ja päivitä taulu.
          // Huomaa, että `reload`-kutsu lataa tässä asetetun sanoman.
          this.reaaliaikainen_sanoma = sanoma;
          this.datatable.ajax.reload();
          // Käytä kutakin reaaliaikaista sanomaa vain kerran.
          delete this.reaaliaikainen_sanoma;
          return;
        }
        else if (sanoma.draw in this.viestijono) {
          // Vastaus aiempaan datapyyntöön. Kutsu tallennettua
          // paluukutsufunktiota ja poista sitten pyyntö.
          this.viestijono[sanoma.draw](sanoma);
          delete this.viestijono[sanoma.draw];
          return;
        }
        else
          // Sanoma poikkeaa pyyntöjärjestyksestä;
          // ilmoita JS-konsolin kautta.
          // Huomaa, että tämä voi johtua verkkoyhteydestä johtuvista
          // tekijöistä, ei välttämättä virhetilanteesta.
          console.log("Sanoma ei vastaa pyyntöä:", sanoma.draw);
      }

      // Jos sanoma ei sisältänyt pyydettyä dataa, suoritetaan
      // silti mahdolliset `xhr`-paluukutsut.
      // Huomaa, että normaalin sanoman yhteydessä `callback`-
      // funktio tekee tämän.
      this.dtSettings.json = sanoma;
      this.dtKutsu("_fnCallbackFire", [
        this.dtSettings, null, "xhr", [
          this.dtSettings, sanoma, this.dtSettings.jqXHR
        ]
      ]);
    }
  });

}(jQuery));
