'use strict';
var _ = require('lodash');
var chalk = require('chalk');
var flatten = require('flat');
var gutil = require('gulp-util');
var Promise = require('bluebird');
var request = require('request-promise');
var stringify = require('json-stable-stringify');
var through = require('through2');

/**
 * Interns.
 */
var locoApi = require('./locoApi');

/**
 * TODO: Add write file method
 * Synchronizr
 * This synchronize the local json token with Loco.
 * @param {object} options Synchronize Loco's options.
 *
 * How the synchronization works?
 * This synchronization is mastered by Loco (http://localise.biz), that is to
 * say the right tokens are always from Loco. You can't erease tokens by simply
 * removes it from the json file, you should do it from Loco.
 *
 * This synchronization processes by multiple tasks:
 * 1. Check if locales given in options are comprised in Loco's locales.
 * If not, add this locale to Loco. All Loco's locales are in 'xx_XX' format
 * like 'en_CA', so your locale in 'xx' like 'en' should be converted to Loco's
 * format.
 *
 * 2. Get all tags available from Loco. If the the tags given in options aren't
 * in Loco yet, create it first. Loco will ignore not existing tags otherwise.
 *
 * 3. Get all remote catalogs associated to the locale. Then for each assets in
 * a catalog, test if the assets is already defined in your json file. You have
 * to convert null asset's values to empty string "" because Loco will not
 * import null value.
 *
 * 4. Import to Loco the processed assets.
 *
 * 5. Tag assets (tag+fuzzy).
 *
 * 6. Finaly, get remote catalog of assets from Loco to write the new json
 * localization file with translations.
 */
function Synchronizr (options) {
    this.api = new locoApi(options.apiKey);
}

Synchronizr.prototype.testLocale = function (locale) {
    var self = this,
        locoLocales = [];

    return this.api
        .getLocales()
        .then(function (apiLocales) {
            _.each(apiLocales, function (apiLocale) {
                locoLocales.push(apiLocale.code);
            });

            if (locoLocales.indexOf(locale) < 0) {
                locoLocales.push(locale);
                gutil.log('Locale "' + locale + '" added.');
                return Promise.resolve(self.api
                    .addLocale({code: locale}));
            }

            return true;
        })
        .catch(function (response) {
            gutil.log(
                chalk.red('TestLocale error: \n' + JSON.stringify(response))
            );
        });
};

Synchronizr.prototype.createTags = function (tags) {
    var self = this;

    return this.api
        .getTags()
        .then(function (apiTags) {

            /**
             * Create tags with tags given in series.
             */
            return tags.reduce(function(promise, value) {
                return promise.then(function() {
                    gutil.log('Create tag "' + value + '".');
                    return Promise.resolve(self.api
                        .createTag({name : value}));
                });
            }, Promise.resolve());
        })
        .catch(function (response) {
            gutil.log(
                chalk.red('Create tags error: \n' + JSON.stringify(response))
            );
        });
};

Synchronizr.prototype.process = function (locale, tags, content) {
    var skipToken = false,
        self = this;

    return this.api
        .exportLocale(locale, tags)
        .then(function (apiAssets) {
            var flatApiAssets = flatten(JSON.parse(apiAssets));
            var fileTokens = _.clone(content);
            _.each(fileTokens, function (assetValue, assetToken) {
                _.each(flatApiAssets, function(apiAssetValue, apiAssetKey) {
                    if (apiAssetKey === assetToken) {
                        gutil.log(chalk.grey(
                            'Skip existing asset translated: ' + assetToken + '.'
                        ));
                        delete fileTokens[assetToken];
                        skipToken = true;
                        return;
                    }
                });

                if (skipToken) {
                    skipToken = false;
                    return;
                }

                // TODO: make this an option.
                // Will not import null value.
                if (typeof assetValue === null) {
                    fileTokens[assetToken] = '';
                }

                gutil.log('Import asset: ' + assetToken + '.');
            });

            if (Object.keys(fileTokens).length < 1) {
                gutil.log(chalk.green('No token to synchronize.'));
                return _.extend(fileTokens, flatApiAssets);
            }

            gutil.log('Will import '+ Object.keys(fileTokens).length +' asset(s).');

            // Import tokens to api.
            self.api
                .importAsync(locale, fileTokens)
                .then(function () {

                    var keys = [];
                    _.each(fileTokens, function(token, key) {
                        keys.push(key);
                    });

                    /**
                     * Tag assets with tags given in series.
                     */
                    keys.reduce(function(promise, value) {
                        return promise.then(function() {
                            gutil.log('Tag asset "' + value + '" with [' + tags + '].');
                            return Promise.resolve(self.api
                                .tagAsset(value, tags));
                        });
                    }, Promise.resolve());

                    /**
                     * Flag assets as fuzzy in series.
                     */
                    keys.reduce(function(promise, value) {
                        return promise.then(function() {
                            gutil.log('Flag asset "' + value + '" as "Fuzzy".');
                            return Promise.resolve(self.api
                                    .setStatus(value, 'fuzzy', locale));
                        });
                    }, Promise.resolve());

                });
            return _.extend(fileTokens, flatApiAssets);
        });
};

module.exports = Synchronizr;
