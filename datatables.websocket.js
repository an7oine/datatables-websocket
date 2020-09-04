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

    // Alusta yhteyden parametrit ja konteksti.
    this.url = settings.ajax.url;
    this.websocket = null;
    this.viestijono = null;

    // Alusta Ajax-datafunktio joko annettuna funktiona
    // tai uutena funktiona, joka yhdistää annetun, kiinteän
    // dataobjektin pyyntökohtaiseen;
    // vrt. `jquery.dataTables.js`, funktio `_fnBuildAjax`.
    var ajax = settings.ajax, ajaxData = settings.ajax.data;
    if (typeof ajaxData !== "function")
      ajaxData = function (data, settings) {
        return $.extend(true, data, ajax.data);
      };

    // Kääri em. datafunktio siten, että oliomuotoinen data
    // sarjallistetaan merkkijonoksi;
    // vrt. jQuery; `src/ajax.js`, funktio `ajax`.
    this.data = function (data, settings) {
      data = ajaxData(data, settings);
      if (! data || typeof data === "string")
        return data;
      return $.param(data, ajax.traditional);
    };

    // Aseta Ajax-datapyyntöjen käsittelyfunktio.
    settings.ajax = function (data, callback, settings) {
      settings._websocket.kasittele_pyynto(data, callback, settings);
    };

    // Avaa WS-yhteys.
    this.avaa_yhteys();
  };

  $.extend(DTWebsocket.prototype, {
    virheviesti: function (virhe, tn) {
      $.fn.DataTable.ext.internal._fnLog.apply(
        this.datatable, [this.datatable.settings()[0], 0, virhe, tn]
      );
    },

    avaa_yhteys: function () {
      // Avaa yhteys GET-pyynnön mukaiseen polkuun.
      var that = this;
      this.websocket = new WebSocket(this.url);
      this.viestijono = null;
      this.websocket.onopen = function () {
        // Ensimmäisen kerran yhteyden muodostuksen jälkeen
        // alustetaan viestijono ja päivitetään taulun sisältö.
        if (that.viestijono === null) {
          that.viestijono = {};
          that.datatable.ajax.reload();
        }
      };
      this.websocket.onmessage = function (e) {
        // Hae käsittelyfunktio saapuvalle sanomalle
        // `draw`-parametrin mukaan.
        // Poista funktio suorituksen jälkeen.
        try {
          var sanoma = JSON.parse(e.data);
        } catch (error) {
          that.virheviesti('Virheellinen sanoma');
          return;
        }
        if (sanoma.draw in that.viestijono) {
          if ('error' in sanoma)
            that.virheviesti(sanoma.error);
          else if ('draw' in sanoma && sanoma.draw in that.viestijono)
            that.viestijono[sanoma.draw](sanoma);
          else
            that.virheviesti('Virheellinen sanoma');
          delete that.viestijono[sanoma.draw];
        }
      };
      this.websocket.onclose = function (e) {
        // Kun yhteys palvelimeen katkeaa, anna virheilmoitus
        // ja yritä hetken kuluttua uudelleen.
        if (that.viestijono) {
          var pyynto = Object.values(that.viestijono)[0];
          if (pyynto) {
            delete that.viestijono[pyynto.draw];
          }
        }
        if (! e.wasClean)
          setTimeout(function () { that.avaa_yhteys(); }, 200);
        else
          setTimeout(function () { that.avaa_yhteys(); }, 50);
      };
      this.websocket.onerror = function (e) {
        if (that.viestijono) {
          var pyynto = Object.values(that.viestijono)[0];
          if (pyynto) {
            that.virheviesti('Virhe palvelinyhteydessä', 7);
            delete that.viestijono[pyynto.draw];
          }
        }
      };
    },

    kasittele_pyynto: function (data, callback, settings) {
      // Mikäli Websocket-yhteys ei ole vielä valmis, odotetaan.
      if (! this.viestijono)
        return;

      // Tyhjennetään mahdolliset aiemmat, edelleen käynnissä
      // olevat pyynnöt. Jäädään odottamaan paluusanomaa.
      this.viestijono = {[data.draw]: callback};

      // Lähetetään pyyntödata URL-koodattuna merkkijonona.
      this.websocket.send(this.data(data));
    }
  });
}(jQuery));
