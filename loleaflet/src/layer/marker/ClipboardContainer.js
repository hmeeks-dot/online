/* -*- js-indent-level: 8 -*- */
/*
 * L.ClipboardContainer is the hidden textarea, which handles text
 * input events and clipboard selection.
 *
 */

/* global */

L.ClipboardContainer = L.Layer.extend({
	initialize: function() {
		// Flag to denote the composing state, derived from
		// compositionstart/compositionend events; unused
		this._isComposing = false;

		// Clearing the area can generate input events
		this._ignoreInputCount = 0;

		// Content
		this._lastContent = []; // unicode characters

		// Debug flag, used in fancyLog(). See the debug() method.
//		this._isDebugOn = true;
		this._isDebugOn = false;

		this._initLayout();

		// Under-caret orange marker.
		this._cursorHandler = L.marker(new L.LatLng(0, 0), {
			icon: L.divIcon({
				className: 'leaflet-cursor-handler',
				iconSize: null
			}),
			draggable: true
		}).on('dragend', this._onCursorHandlerDragEnd, this);

		var that = this;
		this._selectionHandler = function(ev) { that._onEvent(ev); }
	},

	onAdd: function() {
		if (this._container) {
			this.getPane().appendChild(this._container);
			this.update();
		}

		this._emptyArea();

		L.DomEvent.on(this._textArea, 'focus blur', this._onFocusBlur, this);

		// Do not wait for a 'focus' event to attach events if the
		// textarea/contenteditable is already focused (due to the autofocus
		// HTML attribute, the browser focusing it on DOM creation, or whatever)
		if (document.activeElement === this._textArea) {
			this._onFocusBlur({ type: 'focus' });
		}

		L.DomEvent.on(this._map.getContainer(), 'mousedown touchstart', this._abortComposition, this);
	},

	onRemove: function() {
		if (this._container) {
			this.getPane().removeChild(this._container);
		}
		L.DomEvent.off(this._textArea, 'focus blur', this._onFocusBlur, this);

		L.DomEvent.off(this._map.getContainer(), 'mousedown touchstart', this._abortComposition, this);

		this._map.removeLayer(this._cursorHandler);
	},

	_onFocusBlur: function(ev) {
		this._fancyLog(ev.type, '');

		var onoff = (ev.type == 'focus' ? L.DomEvent.on : L.DomEvent.off).bind(L.DomEvent);

		// Debug - connect first for saner logging.
		onoff(
			this._textArea,
			'copy cut compositionstart compositionupdate compositionend select keydown keypress keyup beforeinput textInput textinput input',
			this._onEvent,
			this
		);

		onoff(this._textArea, 'input', this._onInput, this);
		onoff(this._textArea, 'compositionstart', this._onCompositionStart, this);
		onoff(this._textArea, 'compositionupdate', this._onCompositionUpdate, this);
		onoff(this._textArea, 'compositionend', this._onCompositionEnd, this);
		onoff(this._textArea, 'keyup', this._onKeyUp, this);
		onoff(this._textArea, 'copy cut paste', this._map._handleDOMEvent, this._map);

		this._map.notifyActive();

		if (ev.type === 'blur' && this._isComposing) {
			this._abortComposition(ev);
		}
	},

	// Focus the textarea/contenteditable
	focus: function() {
		if (this._map._permission !== 'edit') {
			console.log('EPIC HORRORS HERE');
			return;
		}
		this._textArea.focus();
	},

	blur: function() {
		this._textArea.blur();
	},

	// Marks the content of the textarea/contenteditable as selected,
	// for system clipboard interaction.
	select: function select() {
		this._textArea.select();
	},

	warnCopyPaste: function() {
		var self = this;
		vex.dialog.alert({
			unsafeMessage: _('<p>Your browser has very limited access to the clipboard, so use these keyboard shortcuts:<ul><li><b>Ctrl+C</b>: For copying.</li><li><b>Ctrl+X</b>: For cutting.</li><li><b>Ctrl+V</b>: For pasting.</li></ul></p>'),
			callback: function () {
				self._map.focus();
			}
		});
	},

	getValue: function() {
		var value = this._textArea.value;
		// kill unwanted entities
		value = value.replace(/&nbsp;/g, ' ');
		return value;
	},

	getValueAsCodePoints: function() {
		var value = this.getValue();
		var arr = [];
		var code;
		for (var i = 0; i < value.length; ++i)
		{
			code = value.charCodeAt(i);

			// if it were not for IE11: "for (code of value)" does the job.
			if (code >= 0xd800 && code <= 0xdbff) // handle UTF16 pairs.
			{
				// TESTME: harder ...
				var high = (code - 0xd800) << 10;
				code = value.charCodeAt(++i);
				code = high + code - 0xdc00 + 0x100000;
			}
			arr.push(code);
		}
		return arr;
	},

	setValue: function(val) {
		// console.log('clipboard setValue: ', val);
		if (this._legacyArea) {
			var tmp = document.createElement('div');
			tmp.innerHTML = val;
			this._textArea.value = tmp.innerText || tmp.textContent || '';
		} else {
			this._textArea.innerHTML = val;
		}
	},

	update: function() {
		if (this._container && this._map && this._latlng) {
			var position = this._map.latLngToLayerPoint(this._latlng).round();
			this._setPos(position);
		}
	},

	_initLayout: function() {
		this._container = L.DomUtil.create('div', 'clipboard-container');
		this._container.id = 'doc-clipboard-container';

		// The textarea allows the keyboard to pop up and so on.
		// Note that the contents of the textarea are NOT deleted on each composed
		// word, in order to make
		this._textArea = L.DomUtil.create('textarea', 'clipboard', this._container);
		this._textArea.setAttribute('autocapitalize', 'off');
		this._textArea.setAttribute('autofocus', 'true');
		this._textArea.setAttribute('autocorrect', 'off');
		this._textArea.setAttribute('autocomplete', 'off');
		this._textArea.setAttribute('spellcheck', 'false');

		this._setupStyles();

		this._emptyArea();
	},

	_setupStyles: function() {
		if (this._isDebugOn) {
			// Style for debugging
			this._container.style.opacity = 0.5;
			this._textArea.style.cssText = 'border:1px solid red !important';
			this._textArea.style.width = '120px';
			this._textArea.style.height = '50px';
			this._textArea.style.overflow = 'display';

			this._textArea.style.fontSize = '30px';
			this._textArea.style.position = 'relative';
			this._textArea.style.left = '10px';
		} else {
			this._container.style.opacity = 0;
			this._textArea.style.width = '1px';
			this._textArea.style.height = '1px';
			this._textArea.style.caretColor = 'transparent';

			if (window.isInternetExplorer || L.Browser.edge)
			{
				// Setting the font-size to zero is the only reliable
				// way to hide the caret in MSIE11, as the CSS "caret-color"
				// property is not implemented.
				this._textArea.style.fontSize = '0';
			}
		}
	},

	debug: function(debugOn) {
		this._isDebugOn = !!debugOn;
		this._setupStyles();
	},

	activeElement: function() {
		return this._textArea;
	},

	// Displays the caret and the under-caret marker.
	// Fetches the coordinates of the caret from the map's doclayer.
	showCursor: function() {
		if (!this._map._docLayer._cursorMarker) {
			return;
		}

		// Fetch top and bottom coords of caret
		var top = this._map._docLayer._visibleCursor.getNorthWest();
		var bottom = this._map._docLayer._visibleCursor.getSouthWest();

		// Display caret
		this._map.addLayer(this._map._docLayer._cursorMarker);

		// Move and display under-caret marker
		if (L.Browser.touch) {
			this._cursorHandler.setLatLng(bottom).addTo(this._map);
		}

		// Move the hidden text area with the cursor
		this._latlng = L.latLng(top);
		this.update();
	},

	// Hides the caret and the under-caret marker.
	hideCursor: function() {
		if (!this._map._docLayer._cursorMarker) {
			return;
		}
		this._map.removeLayer(this._map._docLayer._cursorMarker);
		this._map.removeLayer(this._cursorHandler);
	},

	_setPos: function(pos) {
		L.DomUtil.setPosition(this._container, pos);
	},

	// Generic handle attached to most text area events, just for debugging purposes.
	_onEvent: function _onEvent(ev) {
		var msg = {
			inputType: ev.inputType,
			data: ev.data,
			key: ev.key,
			isComposing: ev.isComposing
		};

		if ('key' in ev) {
			msg.key = ev.key;
			msg.keyCode = ev.keyCode;
			msg.code = ev.code;
			msg.which = ev.which;
		}
		this._fancyLog(ev.type, msg);
	},

	_fancyLog: function _fancyLog(type, payload) {
		// Avoid unhelpful exceptions
		if (payload === undefined)
			payload = 'undefined';
		else if (payload === null)
			payload = 'null';

		// Save to downloadable log
		L.Log.log(payload.toString(), 'INPUT');

		// Pretty-print on console (but only if "tile layer debug mode" is active)
		if (this._isDebugOn) {
			var state = this._isComposing ? 'C' : 'N';
			state += ' ';

			var sel = window.getSelection();
			var content = this.getValue();
			if (sel === null)
				state += '-1';
			else
			{
				state += sel.rangeCount;

				state += ' ';
				var cursorPos = -1;
				for (var i = 0; i < sel.rangeCount; ++i)
				{
					var range = sel.getRangeAt(i);
					state += range.startOffset + '-' + range.endOffset + ' ';
					if (cursorPos < 0)
						cursorPos = range.startOffset;
				}
				if (sel.toString() !== '')
					state += ': "' + sel.toString() + '" ';

				// inject probable cursor
				if (cursorPos >= 0)
					content = content.slice(0, cursorPos) + '|' + content.slice(cursorPos);
			}

			console.log2(
				+ new Date() + ' %cINPUT%c: ' + state
				+ '"' + content + '" ' + type + '%c ',
				'background:#bfb;color:black',
				'color:green',
				'color:black',
				JSON.stringify(payload)
			);
		}
	},

	// Fired when text has been inputed, *during* and after composing/spellchecking
	_onInput: function _onInput(/* ev */) {
		this._map.notifyActive();

		if (this._ignoreInputCount > 0) {
			console.log('ignoring synthetic input ' + this._ignoreInputCount);
			return;
		}

		var content = this.getValueAsCodePoints();

		// We use a different leading and terminal space character
		// to differentiate backspace from delete, then replace the character.
		if (content[0] !== 16*10) { // missing initial non-breaking space.
			console.log('Sending backspace');
			this._removeTextContent(1, 0);
			this._emptyArea();
			return;
		}
		if (content[content.length-1] !== 32) { // missing trailing space.
			console.log('Sending delete');
			this._removeTextContent(0, 1);
			this._emptyArea();
			return;
		}

		// remove leading & tailing spaces.
		content = content.slice(1, -1);

		var matchTo = 0;
		var sharedLength = Math.min(content.length, this._lastContent.length);
		while (matchTo < sharedLength && content[matchTo] === this._lastContent[matchTo])
			matchTo++;

		console.log('Comparison matchAt ' + matchTo + '\n' +
			    '\tnew "' + String.fromCharCode.apply(null, content) + '" (' + content.length + ')' + '\n' +
			    '\told "' + String.fromCharCode.apply(null, this._lastContent) + '" (' + this._lastContent.length + ')');

		var remove = this._lastContent.length - matchTo;
		if (remove > 0)
			this._removeTextContent(remove, 0);

		var newText = content;
		if (matchTo > 0)
			newText = newText.slice(matchTo);

		this._lastContent = content;

		if (newText.length > 0)
			this._sendText(String.fromCharCode.apply(null, newText));
	},

	// Sends the given (UTF-8) string of text to lowsd, as IME (text composition)
	// messages
	_sendText: function _sendText(text) {
		this._fancyLog('send-text-to-lowsd', text);

		// MSIE/Edge cannot compare a string to "\n" for whatever reason,
		// so compare charcode as well
		if (text === '\n' || (text.length === 1 && text.charCodeAt(0) === 13)) {
			// we get a duplicate key-event on Gecko, oddly so drop it.
			if (!L.Browser.gecko)
			{
				// The composition messages doesn't play well with just a line break,
				// therefore send a keystroke.
				this._sendKeyEvent(13, 1280);
				this._emptyArea();
			}
		} else {
			// The composition messages doesn't play well with line breaks inside
			// the composed word (e.g. word and a newline are queued client-side
			// and are sent together), therefore split and send keystrokes accordingly.

			var parts = text.split(/[\n\r]/);
			var l = parts.length;
			for (var i = 0; i < l; i++) {
				if (i !== 0) {
					this._sendKeyEvent(13, 1280);
					this._emptyArea();
				}
				if (parts[i].length > 0) {
					this._sendCompositionEvent('input', parts[i]);
					this._sendCompositionEvent('end', parts[i]);
				}
			}
		}
	},

	// Empties the textarea / contenteditable element.
	// If the browser supports the 'inputType' property on 'input' events, then
	// add empty spaces to the textarea / contenteditable, in order to
	// always catch deleteContentBackward/deleteContentForward input events
	// (some combination of browser + input method don't fire those on an
	// empty contenteditable).
	_emptyArea: function _emptyArea() {
		this._fancyLog('empty-area');

		this._ignoreInputCount++;
		// Note: 0xA0 is 160, which is the character code for non-breaking space:
		// https://www.fileformat.info/info/unicode/char/00a0/index.htm
		// Using normal spaces would make FFX/Gecko collapse them into an
		// empty string.

		console.log('Set old/lastContent to empty');
		this._lastContent = [];

		this._textArea.value = '\xa0 ';
		/// TODO: Check that this selection method works with MSIE11
		this._textArea.setSelectionRange(1, 1);

		this._ignoreInputCount--;
	},

	_onCompositionStart: function _onCompositionStart(/*ev*/) {
		this._isComposing = true;
	},

	// Handled only in legacy situations ('input' events with an inputType
	// property are preferred).
	_onCompositionUpdate: function _onCompositionUpdate(ev) {
		this._map.notifyActive();
		this._onInput(ev);
	},

	// Chrome doesn't fire any "input/insertCompositionText" with "isComposing" set to false.
	// Instead , it fires non-standard "textInput" events, but those can be tricky
	// to handle since Chrome also fires "input/insertText" events.
	// The approach here is to use "compositionend" events *only in Chrome* to mark
	// the composing text as committed to the text area.
	_onCompositionEnd: function _onCompositionEnd(ev) {
		this._map.notifyActive();
		this._isComposing = false;
		this._onInput(ev);
	},

	// Called when the user goes back to a word to spellcheck or replace it,
	// on a timeout.
	// Very difficult to handle right now, so the strategy is to panic and
	// empty the text area.
	_abortComposition: function _abortComposition(ev) {
		this._fancyLog('abort-composition', ev.type);
		if (this._isComposing)
			this._isComposing = false;
		this._emptyArea();
	},

	// Override the system default for pasting into the textarea/contenteditable,
	// and paste into the document instead.
	_onPaste: function _onPaste(ev) {
		// Prevent the event's default - in this case, prevent the clipboard contents
		// from being added to the hidden textarea and firing 'input'/'textInput' events.
		ev.preventDefault();

		// TODO: handle internal selection here (compare pasted plaintext with the
		// last copied/cut plaintext, send a UNO 'paste' command over websockets if so.
		// 		if (this._lastClipboardText === ...etc...

		var pasteString;
		if (ev.clipboardData) {
			pasteString = ev.clipboardData.getData('text/plain'); // non-IE11
		} else if (window.clipboardData) {
			pasteString = window.clipboardData.getData('Text'); // IE 11
		}

		if (pasteString && pasteString === this._lastClipboardText) {
			// If the pasted text is the same as the last copied/cut text,
			// let lowsd use LOK's clipboard instead. This is done in order
			// to keep formatting and non-text bits.
			this._map._socket.sendMessage('uno .uno:Paste');
			return;
		}

		// Let the TileLayer functionality take care of sending the
		// DataTransfer from the event to lowsd.
		this._map._docLayer._dataTransferToDocument(
			ev.clipboardData || window.clipboardData /* IE11 */
		);

		this._abortComposition();
	},

	// Override the system default for cut & copy - ensure that the system clipboard
	// receives *plain text* (instead of HTML/RTF), and save internal state.
	// TODO: Change the 'gettextselection' command, so that it can fetch the HTML
	// version of the copied text **maintaining typefaces**.
	_onCutCopy: function _onCutCopy(ev) {
		var plaintext = document.getSelection().toString();

		this._lastClipboardText = plaintext;

		if (ev.type === 'copy') {
			this._map._socket.sendMessage('uno .uno:Copy');
		} else if (ev.type === 'cut') {
			this._map._socket.sendMessage('uno .uno:Cut');
		}

		if (event.clipboardData) {
			event.clipboardData.setData('text/plain', plaintext); // non-IE11
		} else if (window.clipboardData) {
			window.clipboardData.setData('Text', plaintext); // IE 11
		} else {
			console.warn('Could not set the clipboard contents to plain text.');
			return;
		}

		event.preventDefault();
	},

	// Check arrow keys on 'keyup' event; using 'ArrowLeft' or 'ArrowRight'
	// shall empty the textarea, to prevent FFX/Gecko from ever not having
	// whitespace around the caret.
	// Across browsers, arrow up/down / home / end would move the caret to
	// the beginning/end of the textarea/contenteditable.
	_onKeyUp: function _onKeyUp(ev) {
		this._map.notifyActive();
		if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
		    ev.key === 'ArrowUp' || ev.key === 'ArrowDown' ||
		    ev.key === 'Home' || ev.key === 'End' ||
		    ev.key === 'PageUp' || ev.key === 'PageDown'
		) {
			this._emptyArea();
		}
	},

	// Used in the deleteContentBackward for deleting multiple characters with a single
	// message.
	// Will remove characters from the queue first, if there are any.
	_removeTextContent: function _removeTextContent(before, after) {
		console.log('Remove ' + before + ' before, and ' + after + ' after');

		/// TODO: rename the event to 'removetextcontent' as soon as lowsd supports it
		/// TODO: Ask Marco about it
		this._map._socket.sendMessage(
			'removetextcontext id=' +
			this._map.getWinId() +
			' before=' + before +
			' after=' + after
		);
	},

	// Tiny helper - encapsulates sending a 'textinput' websocket message.
	// "type" is either "input" for updates or "end" for commits.
	_sendCompositionEvent: function _sendCompositionEvent(type, text) {
		console.log('sending to lowsd: ', type, text);
		this._map._socket.sendMessage(
			'textinput id=' +
				this._map.getWinId() +
				' type=' +
				type +
				' text=' +
				encodeURIComponent(text)
		);
	},

	// Tiny helper - encapsulates sending a 'key' or 'windowkey' websocket message
	// "type" can be "input" (default) or "up"
	_sendKeyEvent: function _sendKeyEvent(charCode, unoKeyCode, type) {
		if (!type) {
			type = 'input';
		}
		if (this._map.getWinId() === 0) {
			this._map._socket.sendMessage(
				'key type=' + type + ' char=' + charCode + ' key=' + unoKeyCode + '\n'
			);
		} else {
			this._map._socket.sendMessage(
				'windowkey id=' +
					this._map.getWinId() +
					' type=' +
					type +
					' char=' +
					charCode +
					' key=' +
					unoKeyCode +
					'\n'
			);
		}
	},

	_onCursorHandlerDragEnd: function _onCursorHandlerDragEnd(ev) {
		var cursorPos = this._map._docLayer._latLngToTwips(ev.target.getLatLng());
		this._map._docLayer._postMouseEvent('buttondown', cursorPos.x, cursorPos.y, 1, 1, 0);
		this._map._docLayer._postMouseEvent('buttonup', cursorPos.x, cursorPos.y, 1, 1, 0);
	}
});

L.clipboardContainer = function() {
	return new L.ClipboardContainer();
};
