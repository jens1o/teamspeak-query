'use strict';

const net = require('net'),
	  EventEmitter = require('events').EventEmitter,
	  type = require('type-of'),
	  carrier = require('carrier');

class TeamspeakQuery extends EventEmitter {

	/**
	 * Create a new Query Client
	 *
	 * @class
	 *
	 * @param      {String}  [host=127.0.0.1]  The IP of your teamspeak server
	 * @param      {Number}  [port=10011]      The port of your teamspeak server
	 * @param      {Object}  [options=Object]  Options for the socket
	 */
	constructor(host, port, options) {
		super();

		let sock = this.sock = new net.Socket(options || { });

		this.queue = [ ];
		this._current = null;
		this._statusLines = 0;

		host = host || '127.0.0.1'
		port = port || 10011;

		sock.connect(port, host);

		sock.on('connect', () => {
			this.carrier = carrier.carry(sock);
			this.carrier.on('line', this.handleLine.bind(this));
		});
	}

	/**
	 * Send a command to the server
	 *
	 * @param      {String}   cmd      The command to execute
	 * @param      {Object}   options  Options or flags for the command
	 * @return     {Promise}  Promise resolves if the command executes
	 *                        successfully, rejects if an error code is
	 *                        returned.
	 */
	send(cmd, options) {
		let cmdStringParts = [ cmd ],
			flags = Array.from(arguments).slice(2);

		if(options && type(options) !== 'object') 
			flags.unshift(options);
		else {
			for(let key in options) {
				var val = options[key];

				if(type(val) === 'array') {
					val = val.map(v => TeamspeakQuery.escape(key) + '=' + TeamspeakQuery.escape(v) ).join('|');
					cmdStringParts.push(val);
				} else
					cmdStringParts.push( TeamspeakQuery.escape(key) + '=' + TeamspeakQuery.escape(val) );
			}
		}

		flags = flags.map( TeamspeakQuery.escape );
		cmdStringParts = cmdStringParts.concat(flags);

		let promise = new Promise((resolve, reject) =>
			this.queue.push({ 'cmd': cmdStringParts.join(' '), resolve, reject }) );

		if(this._statusLines > 1) this.checkQueue();
		return promise;
	}

	/**
	 * Checks the queue and runs the first command if nothing else is running
	 */
	checkQueue() {
		if(!this._current && this.queue.length) {
			this._current = this.queue.shift();
			this.sock.write(this._current.cmd + '\n');
		}
	}

	/**
	 * Handle each line sent by the server
	 *
	 * @param      {String}  line    The line sent by the server
	 */
	handleLine(line) {
		if(this._statusLines < 2) {
			this._statusLines++;
			if(this._statusLines === 2) this.checkQueue();
		} else {
			line = line.trim();

			let response = TeamspeakQuery.parse(line);

			if(!response) return;

			if(response.type && response.type.indexOf('notify') === 0)
				this.emit(response.type.slice(6), response.params, line);
			else if(response.type && response.type === 'error') {
				if(response.params.id == 0) this._current.resolve(this._current.data || response.params);
				else this._current.reject(response.params);

				this._current = null;
			} else if(this._current)
				this._current.data = response.params;

			this.checkQueue();
		}
	}

	/**
	 * Parse a server response into an object
	 *
	 * @param      {string}  str     The string to parse
	 * @return     {Object}  The type and params of the response. Returns null
	 *                       if parsing fails.
	 */
	static parse(str) {
		let parsed = str.match(/(^error|^notify\w+|\w+=[^\s\|]+)/gi);

		if(parsed) {
			let resType = parsed[0].indexOf('=') === -1 ? parsed.shift() : null, // Only shift if the server responds with 'error' or 'notify'
				params = { };

			parsed.forEach(v => {
				v = v.split(/=/).map(TeamspeakQuery.unescape);

				if(v[0] in params) {
					if(type(params[v[0]]) !== 'array') params[v[0]] = [ params[v[0]], v[1] ];
					else params[v[0]].push(v[1]);
				} else
					params[v[0]] = v[1];
			});

			return { 'type': resType, params };

		} else
			return null;
	}

	/**
	 * Escape a String according to the specs
	 *
	 * @static
	 *
	 * @param      {String}  str     The string to escape
	 * @return     {String}  The escaped string
	 */
	static escape(str) {
		return String(str).replace(/\\/g, '\\\\')
			.replace(/\//g, '\\/')
			.replace(/\|/g, '\\p')
			.replace(/\n/g, '\\n')
			.replace(/\r/g, '\\r')
			.replace(/\t/g, '\\t')
			.replace(/\v/g, '\\v')
			.replace(/\f/g, '\\f')
			.replace(/ /g, '\\s');
	}

	/**
	 * Unescape a String according to the specs
	 *
	 * @static
	 *
	 * @param      {string}  str     The string
	 * @return     {string}  The unescaped string
	 */
	static unescape(str) {
		return String(str).replace(/\\\\/g, '\\')
			.replace(/\\\//g, '/')
			.replace(/\\p/g, '|')
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')
			.replace(/\\v/g, '\v')
			.replace(/\\f/g, '\f')
			.replace(/\\s/g, ' ');
	}
}

module.exports = TeamspeakQuery;