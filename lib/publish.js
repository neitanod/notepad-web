class Publish {
    constructor(options = {}) {
        this.endpoint = options.endpoint || 'https://publish.ip1.cc';
        this.storageKey = options.storageKey || 'publish-secret-key';
        this.autoHash = options.autoHash !== false;
        this.defaultName = options.defaultName || (() => 'doc-' + Date.now() + '.txt');
    }

    getSecretKey() {
        let key = localStorage.getItem(this.storageKey);
        if (!key) {
            const arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            key = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(this.storageKey, key);
        }
        return key;
    }

    parseHash(hash) {
        if (!hash) return null;
        if (hash.startsWith('#')) hash = hash.substr(1);
        if (!hash) return null;

        if (hash.startsWith('@')) {
            const path = hash.substr(1);
            const slashIndex = path.indexOf('/');
            if (slashIndex > 0) {
                return {
                    type: 'namespaced',
                    namespace: path.substr(0, slashIndex),
                    name: path.substr(slashIndex + 1)
                };
            }
        }
        return {
            type: 'legacy',
            hash: hash
        };
    }

    buildHash(namespace, name) {
        return '@' + namespace + '/' + name;
    }

    save(data, name = null) {
        const secretKey = this.getSecretKey();
        const docName = name || (typeof this.defaultName === 'function' ? this.defaultName() : this.defaultName);

        const payload = typeof data === 'string' ? data : JSON.stringify(data);

        return axios({
            url: this.endpoint,
            method: 'POST',
            headers: {
                'X-Publish-Key': secretKey
            },
            data: {
                data: payload,
                name: docName
            }
        }).then(r => {
            const url = r.data.trim();
            const match = url.match(/\/p\/([^\/]+)\/(.+)$/);
            if (match) {
                return {
                    url: url,
                    namespace: match[1],
                    name: match[2]
                };
            }
            return { url: url, namespace: null, name: null };
        });
    }

    load(identifier) {
        const parsed = this.parseHash(identifier);
        if (!parsed) return Promise.reject(new Error('Invalid identifier'));

        let url;
        if (parsed.type === 'namespaced') {
            url = this.endpoint + '/p/' + parsed.namespace + '/' + parsed.name;
        } else {
            url = this.endpoint + '/public/' + parsed.hash + '.txt';
        }

        return axios({ url: url }).then(r => r.data);
    }

    bind(options) {
        return new PublishBinding(this, options);
    }
}

class PublishBinding {
    constructor(publish, options) {
        this.publish = publish;
        this.get = options.get;
        this.set = options.set;
        this.name = options.name || null;
        this.onSaveStart = options.onSaveStart || (() => {});
        this.onSaveEnd = options.onSaveEnd || (() => {});
        this.onLoad = options.onLoad || (() => {});
        this.onError = options.onError || ((err) => console.error('Publish error:', err));

        this._currentNamespace = null;
        this._currentName = null;
        this._boundHashChange = this._onHashChange.bind(this);

        if (this.publish.autoHash) {
            window.addEventListener('hashchange', this._boundHashChange);
        }

        // Cargar al inicio si hay hash
        this._initialLoad();
    }

    _initialLoad() {
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            this.reload();
        }
    }

    _onHashChange() {
        this.reload();
    }

    _getName() {
        if (this._currentName) {
            return this._currentName;
        }
        if (this.name) {
            return typeof this.name === 'function' ? this.name() : this.name;
        }
        return typeof this.publish.defaultName === 'function'
            ? this.publish.defaultName()
            : this.publish.defaultName;
    }

    save() {
        this.onSaveStart();

        const data = this.get();
        const name = this._getName();

        return this.publish.save(data, name)
            .then(result => {
                this._currentNamespace = result.namespace;
                this._currentName = result.name;

                if (this.publish.autoHash && result.namespace && result.name) {
                    const newHash = this.publish.buildHash(result.namespace, result.name);
                    if (window.location.hash !== '#' + newHash) {
                        // Evitar que el hashchange dispare reload
                        window.removeEventListener('hashchange', this._boundHashChange);
                        window.location.hash = newHash;
                        setTimeout(() => {
                            window.addEventListener('hashchange', this._boundHashChange);
                        }, 0);
                    }
                }

                this.onSaveEnd(true, result);
                return result;
            })
            .catch(err => {
                this.onSaveEnd(false);
                this.onError(err);
                throw err;
            });
    }

    reload() {
        const hash = window.location.hash;
        const parsed = this.publish.parseHash(hash);

        if (!parsed) return Promise.resolve(null);

        if (parsed.type === 'namespaced') {
            this._currentNamespace = parsed.namespace;
            this._currentName = parsed.name;
        }

        return this.publish.load(hash)
            .then(data => {
                this.set(data);
                this.onLoad(data);
                return data;
            })
            .catch(err => {
                this.onError(err);
                throw err;
            });
    }

    unbind() {
        window.removeEventListener('hashchange', this._boundHashChange);
    }

    getUrl() {
        if (this._currentNamespace && this._currentName) {
            return this.publish.endpoint + '/p/' + this._currentNamespace + '/' + this._currentName;
        }
        return null;
    }
}

// Export para uso como módulo si es necesario
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Publish, PublishBinding };
}
