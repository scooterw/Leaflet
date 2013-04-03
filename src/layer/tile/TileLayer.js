/*
 * L.TileLayer is used for standard xyz-numbered tile layers.
 */

L.TileLayer = L.GridLayer.extend({
	includes: L.Mixin.Events,

	options: {
		async: true,

		minZoom: 0,
		maxZoom: 18,

		subdomains: 'abc',
		errorTileUrl: '',
		attribution: '',
		zoomOffset: 0,

		/*
		zIndex: null,
		tms: false,
		continuousWorld: false,
		noWrap: false,
		zoomReverse: false,
		detectRetina: false,
		reuseTiles: false,
		bounds: false,
		*/

		unloadInvisibleTiles: L.Browser.mobile,
		updateWhenIdle: L.Browser.mobile
	},

	initialize: function (url, options) {
		options = L.setOptions(this, options);

		// detecting retina displays, adjusting tileSize and zoom levels
		if (options.detectRetina && L.Browser.retina && options.maxZoom > 0) {

			options.tileSize = Math.floor(options.tileSize / 2);
			options.zoomOffset++;

			if (options.minZoom > 0) {
				options.minZoom--;
			}
			this.options.maxZoom--;
		}

		if (options.bounds) {
			options.bounds = L.latLngBounds(options.bounds);
		}

		this._url = url;

		var subdomains = this.options.subdomains;

		if (typeof subdomains === 'string') {
			this.options.subdomains = subdomains.split('');
		}
	},

	getAttribution: function () {
		return this.options.attribution;
	},

	setUrl: function (url, noRedraw) {
		this._url = url;

		if (!noRedraw) {
			this.redraw();
		}

		return this;
	},

	getTileUrl: function (coords) {

		var options = this.options,
		    z = coords.z + options.zoomOffset,
		    x, y;

		// TODO refactor, limit is not valid for non-standard projections
		var limit = Math.pow(2, z);

		if (options.zoomReverse) {
			z = options.maxZoom - z;
		}

		// wrap x coordinate
		if (!options.continuousWorld && !options.noWrap) {
			x = ((coords.x % limit) + limit) % limit;
		}

		// invert y coordinate for tms
		if (options.tms) {
			y = limit - coords.y - 1;
		}

		var i = Math.abs(tilePoint.x + tilePoint.y) % options.subdomains.length,
		    s = options.subdomains[i];

		return L.Util.template(this._url, L.extend({
			s: s,
			z: z,
			x: x,
			y: y
		}, this.options));
	},

	createTile: function (coords) {
		if (!this._tileImg) {
			// create tile prototype to clone
			this._tileImg = L.DomUtil.create('img');
			this._tileImg.galleryimg = 'no';
		}

		var tile = this._tileImg.cloneNode(false);

		tile.onload = this._tileOnLoad;
		tile.onerror = this._tileOnError;

		tile._layer = this;

		tile.src = this.getTileUrl(coords);

		return tile;
	},

	_removeTile: function (key) {
		var tile = this._tiles[key];

		L.GridLayer.prototype._removeTile.call(this, key);

		this._cleanupTile(tile);
	},

	_cleanupTile: function (tile) {
		// cleanup memory after removed tile, unless it's Android
		// see https://github.com/Leaflet/Leaflet/issues/137

		if (!L.Browser.android) {
			tile.onload = L.Util.falseFn;
			tile.onerror = L.Util.falseFn;

			tile.src = L.Util.emptyImageUrl;
		}
	},

	_tileLoaded: function () {
		this._tilesToLoad--;

		if (!this._tilesToLoad) {
			this.fire('load');

			if (this._animated) {
				// clear scaled tiles after all new tiles are loaded (for performance)
				clearTimeout(this._clearBgBufferTimer);
				this._clearBgBufferTimer = setTimeout(L.bind(this._clearBgBuffer, this), 500);
			}
		}
	},

	_tileOnLoad: function () {
		// TODO use event instead of _layer etc.

		// TODO make sure this is never L.Util.emptyImageUrl
		L.DomUtil.addClass(this, 'leaflet-tile-loaded');
		this._layer.fire('tileload', {tile: this});

		this._layer._tileLoaded();
	},

	_tileOnError: function () {
		var layer = this._layer;

		layer.fire('tileerror', {
			tile: this,
			url: this.src
		});

		var newUrl = layer.options.errorTileUrl || L.Util.emptyImageUrl;
		if (newUrl) {
			this.src = newUrl;
		}

		layer._tileLoaded();
	},

	_prepareBgBuffer: function () {

		var front = this._tileContainer,
		    bg = this._bgBuffer;

		// if foreground layer doesn't have many tiles but bg layer does,
		// keep the existing bg layer and just zoom it some more

		if (bg && this._getLoadedTilesPercentage(bg) > 0.5 &&
		          this._getLoadedTilesPercentage(front) < 0.5) {

			front.style.visibility = 'hidden';
			this._stopLoadingImages(front);
			return;
		}

		this._swapBgBuffer();
		this._stopLoadingImages(this._bgBuffer);
	},

	_getLoadedTilesPercentage: function (container) {
		var tiles = Array.prototype.slice.call(container.getElementsByTagName('img')),
		    count = 0,
		    i, len;

		for (i = 0, len = tiles.length; i < len; i++) {
			if (tiles[i].complete) {
				count++;
			}
		}
		return count / len;
	},

	// stops loading all images in the given container
	_stopLoadingImages: function (container) {
		var tiles = Array.prototype.slice.call(container.getElementsByTagName('img')),
		    i, len, tile;

		for (i = 0, len = tiles.length; i < len; i++) {
			tile = tiles[i];

			if (!tile.complete) {
				tile.parentNode.removeChild(tile);
				this._cleanupTile(tile);
			}
		}
	}
});

L.tileLayer = function (url, options) {
	return new L.TileLayer(url, options);
};
