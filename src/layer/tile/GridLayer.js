
L.GridLayer = L.Class.extend({

	options: {
		tileSize: 256,
		opacity: 1,

		async: false,
		unloadInvisibleTiles: L.Browser.mobile,
		updateWhenIdle: L.Browser.mobile,
		updateInterval: 150,

		wrapX: true,
		wrapY: false
	},

	initialize: function (options) {
		options = L.setOptions(this, options);
	},

	onAdd: function (map) {
		this._map = map;
		this._animated = map.options.zoomAnimation && L.Browser.any3d;

		this._initContainer();

		if (!this.options.updateWhenIdle) {
			// update tiles on move, but not more often than once per given interval
			this._update = L.Util.limitExecByInterval(this._update, this.options.updateInterval, this);
		}

		map.on(this._getEvents(), this);

		this._reset();
		this._update();
	},

	onRemove: function (map) {
		this._getPane().removeChild(this._container);

		map.off(this._getEvents(), this);

		this._container = null;
		this._map = null;
	},

	addTo: function (map) {
		map.addLayer(this);
		return this;
	},

	getContainer: function () {
		return this._container;
	},

	isValidTile: function (coords) {
		// TODO maxBounds should be intersection of options bounds and earth
		var bounds = this._tileCoordsToBounds(coords),
			sw = bounds.getSouthWest(),
			ne = bounds.getNorthEast()

			maxBounds = this.options.bounds,
			maxSw = maxBounds.getSouthWest(),
			maxNe = maxBounds.getNorthEast();

		return (this.options.wrapX || (sw.lat < maxNe.lat && ne.lat > maxSw.lat)) ||
			   (this.options.wrapY || (sw.lng < maxNe.lng && ne.lng > maxSw.lng));
	},

	bringToFront: function () {
		var pane = this._getPane();

		if (this._container) {
			pane.appendChild(this._container);

			// TODO figure it out
			this._setAutoZIndex(Math.max);
		}

		return this;
	},

	bringToBack: function () {
		var pane = this._getPane();

		if (this._container) {
			pane.insertBefore(this._container, pane.firstChild);
			this._setAutoZIndex(Math.min);
		}

		return this;
	},

	setZIndex: function (zIndex) {
		this.options.zIndex = zIndex;
		this._updateZIndex();

		return this;
	},

	redraw: function () {
		if (this._map) {
			this._reset({hard: true});
			this._update();
		}
		return this;
	},

	setOpacity: function (opacity) {
		this.options.opacity = opacity;

		if (this._map) {
			this._updateOpacity();
		}
		return this;
	},

	createTile: function (coords) {
		return L.DomUtil.create('div');
	},

	_updateZIndex: function () {
		if (this._container && this.options.zIndex !== undefined) {
			this._container.style.zIndex = this.options.zIndex;
		}
	},

	_setAutoZIndex: function (pane, compare) {

		var layers = this._getPane().children,
		    edgeZIndex = -compare(Infinity, -Infinity), // -Infinity for max, Infinity for min
		    zIndex, i, len;

		for (i = 0, len = layers.length; i < len; i++) {

			if (layers[i] !== this._container) {
				zIndex = parseInt(layers[i].style.zIndex, 10);

				if (!isNaN(zIndex)) {
					edgeZIndex = compare(edgeZIndex, zIndex);
				}
			}
		}

		this.options.zIndex = this._container.style.zIndex =
		        (isFinite(edgeZIndex) ? edgeZIndex : 0) + compare(1, -1);
	},

	_getEvents: function () {
		var events = {
			viewreset: this._reset,
			moveend: this._update
		};

		if (!this.options.updateWhenIdle) {
			events.move = this._update;
		}

		if (this._animated) {
			events.zoomanim = this._animateZoom;
			events.zoomend = this._endZoomAnim;
		}

		return events;
	},

	_getPane: function () {
		// TODO pane in options?
		return this._map._panes.tilePane;
	},

	_initContainer: function () {
		if (this._container) { return; }

		this._container = L.DomUtil.create('div', 'leaflet-layer');

		this._updateZIndex();

		if (this._animated) {
			var className = 'leaflet-tile-container leaflet-zoom-animated';

			this._bgBuffer = L.DomUtil.create('div', className, this._container);
			this._tileContainer = L.DomUtil.create('div', className, this._container);
		} else {
			this._tileContainer = this._container;
		}

		// TODO check if opacity works when setting before appendChild
		if (this.options.opacity < 1) {
			this._updateOpacity();
		}

		this._getPane().appendChild(this._container);
	},

	_reset: function (e) {
		var tiles = this._tiles;

		for (var key in tiles) {
			if (tiles.hasOwnProperty(key)) {
				this.fire('tileunload', {
					tile: tiles[key]
				});
			}
		}

		this._tiles = {};
		this._tilesToLoad = 0;

		this._tileContainer.innerHTML = "";

		if (this._animated && e && e.hard) {
			this._clearBgBuffer();
		}

		// TODO removed this._initContainer();, OK?
	},

	_update: function () {

		if (!this._map) { return; }

		var bounds = this._map.getPixelBounds(),
		    zoom = this._map.getZoom(),
		    tileSize = this.options.tileSize;

		if (zoom > this.options.maxZoom ||
		    zoom < this.options.minZoom) { return; }

		var tileBounds = new L.Bounds(
		        bounds.min.divideBy(tileSize)._floor(),
		        bounds.max.divideBy(tileSize)._floor());

		this._addTilesFromCenterOut(tileBounds);

		if (this.options.unloadInvisibleTiles) {
			this._removeOtherTiles(tileBounds);
		}
	},

	_addTilesFromCenterOut: function (bounds) {
		var queue = [],
		    center = bounds.getCenter(),
		    zoom = this._map.getZoom();

		var j, i, coords;

		// fill up the tile queue, not including invalid (e.g. out of bounds) tiles
		for (j = bounds.min.y; j <= bounds.max.y; j++) {
			for (i = bounds.min.x; i <= bounds.max.x; i++) {

				coords = new L.Point(i, j);
				coords.z = zoom;

				if (!this._tileIsAdded(coords) && this.isValidTile(coords)) {
					queue.push(coords);
				}
			}
		}

		if (!queue.length) { return; }

		// if its the first batch of tiles to load, fire loading event
		if (!this._tilesToLoad) {
			this.fire('loading');
		}

		this._tilesToLoad += queue.length;

		// sort the queue to load tiles in order of their distance to center
		queue.sort(function (a, b) {
			return a.distanceTo(center) - b.distanceTo(center);
		});

		var fragment = document.createDocumentFragment();

		for (i = 0; i < tilesToLoad; i++) {
			this._addTile(queue[i], fragment);
		}

		this._tileContainer.appendChild(fragment);
	},

	_tileIsAdded: function (coords) {
		return (coords.x + ':' + coords.y) in this._tiles;
	},

	_tileCoordsToBounds: function (coords) {

		var tileSize = this.options.tileSize,

		    nwPoint = tilePoint.multiplyBy(tileSize),
		    sePoint = nwPoint.add(new L.Point(tileSize, tileSize)),

		    nw = this._map.unproject(nwPoint),
		    se = this._map.unproject(sePoint);

		return new L.LatLngBounds([nw, se]);
	},

	_tileCoordsToKey: function (coords) {
		return coords.x + ':' + coords.y;
	},

	_keyToTileCoords: function (key) {
		var kArr = key.split(':'),
		    x = parseInt(kArr[0], 10),
		    y = parseInt(kArr[1], 10);

		return new L.Point(x, y);
	},

	_removeOtherTiles: function (bounds) {
		var kArr, x, y, key;

		for (key in this._tiles) {
			if (this._tiles.hasOwnProperty(key) && !bounds.contains(this._keyToTileCoords(key))) {
				this._removeTile(key);
			}
		}
	},

	_initTile: function (tile) {
		L.DomUtil.addClass(tile, 'leaflet-tile');

		tile.style.width = size + 'px';
		tile.style.height = size + 'px';

		tile.onselectstart = L.Util.falseFn;
		tile.onmousemove = L.Util.falseFn;

		if (L.Browser.ielt9 && this.options.opacity !== undefined) {
			L.DomUtil.setOpacity(tile, this.options.opacity);
		}
	},

	_addTile: function (coords, container) {
		var tilePos = this._getTilePos(coords),
		    tile = this.createTile(coords),
		    key = this._tileCoordsToKey(coords),
		    size = this.options.tileSize;

		/*
		Chrome 20 layouts much faster with top/left (verify with timeline, frames)
		Android 4 browser has display issues with top/left and requires transform instead
		Android 2 browser requires top/left or tiles disappear on load or first drag
		(reappear after zoom) https://github.com/Leaflet/Leaflet/issues/866
		(other browsers don't currently care) - see debug/hacks/jitter.html for an example
		*/
		L.DomUtil.setPosition(tile, tilePos, L.Browser.chrome || L.Browser.android23);

		this._tiles[key] = tile;

		// TODO
		//this._loadTile(tile, coords);
		// TODO wrapping happens here

		container.appendChild(tile);
	},

	_removeTile: function (key) {
		var tile = this._tiles[key];

		if (tile.parentNode) {
			tile.parentNode.removeChild(tile);
		}

		delete this._tiles[key];

		this.fire("tileunload", {tile: tile});
	},

	_getTilePos: function (coords) {
		var origin = this._map.getPixelOrigin();
		return coords.multiplyBy(this.options.tileSize).subtract(origin);
	},

	_updateOpacity: function () {
		var i,
		    tiles = this._tiles;

		if (L.Browser.ielt9) {
			// hack to force IE to update opacity of tiles
			for (i in tiles) {
				if (tiles.hasOwnProperty(i)) {
					L.DomUtil.setOpacity(tiles[i], this.options.opacity);
				}
			}
		} else {
			L.DomUtil.setOpacity(this._container, this.options.opacity);
		}

		// stupid webkit hack to force redrawing of tiles
		if (L.Browser.webkit) {
			for (i in tiles) {
				if (tiles.hasOwnProperty(i)) {
					tiles[i].style.webkitTransform += ' translate(0,0)';
				}
			}
		}
	},

	_animateZoom: function (e) {
		var firstFrame = false;

		if (!this._animating) {
			this._animating = true;
			firstFrame = true;
		}

		if (firstFrame) {
			this._prepareBgBuffer();
		}

		var transform = L.DomUtil.TRANSFORM,
		    bg = this._bgBuffer;

		if (firstFrame) {
			//prevent bg buffer from clearing right after zoom
			clearTimeout(this._clearBgBufferTimer);

			// hack to make sure transform is updated before running animation
			L.Util.falseFn(bg.offsetWidth);
		}

		var scaleStr = L.DomUtil.getScaleString(e.scale, e.origin),
		    oldTransform = bg.style[transform];

		bg.style[transform] = e.backwards ?
		        (e.delta ? L.DomUtil.getTranslateString(e.delta) : oldTransform) + ' ' + scaleStr :
		        scaleStr + ' ' + oldTransform;
	},

	_endZoomAnim: function () {
		var front = this._tileContainer,
		    bg = this._bgBuffer;

		front.style.visibility = '';
		front.style.zIndex = 2;

		bg.style.zIndex = 1;

		// force reflow
		L.Util.falseFn(bg.offsetWidth);

		this._animating = false;
	},

	_clearBgBuffer: function () {
		var map = this._map;

		if (!map._animatingZoom && !map.touchZoom._zooming) {
			this._bgBuffer.innerHTML = '';
			this._bgBuffer.style[L.DomUtil.TRANSFORM] = '';
		}
	},

	_prepareBgBuffer: function () {
		this._swapBgBuffer();
  	},

  	_swapBgBuffer: function () {
		var front = this._tileContainer,
		    bg = this._bgBuffer;

		// prepare the buffer to become the front tile pane
		bg.style.visibility = 'hidden';
		bg.style[L.DomUtil.TRANSFORM] = '';

		// switch out the current layer to be the new bg layer (and vice-versa)
		this._tileContainer = bg;
		this._bgBuffer = front;
  	}
});

L.gridLayer = function (options) {
	return new L.GridLayer(options);
};
