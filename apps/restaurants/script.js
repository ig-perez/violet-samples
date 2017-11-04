/* Copyright (c) 2017-present, salesforce.com, inc. All rights reserved */
/* Licensed under BSD 3-Clause - see LICENSE.txt or git.io/sfdc-license */

'use strict';

var Promise = require('bluebird');

var utils = require('violet-conversations/lib/utils');
var violet = require('violet-conversations/lib/violet').script();
var violetTime = require('violet-conversations/lib/violetTime')(violet);

var yelpSvc = require('./yelp.js');

module.exports = violet;

var defaultCatsForCaching = ['korean', 'italian', 'french'];
defaultCatsForCaching = []; // disable caching during development

// sometimes multiple spoken items map to the same category and category needs to be a single word
var catAliases = require('./spokenToCategoryAliases.json');



violet.addInputTypes({
  category: {
    type: 'categoryType',
    values: utils.loadArrayFromFile('potentialCategories.txt')
  }
});

// San Fran
var lat =   37.786714;
var lon = -122.411129;


var cache = {
  search: {},
  topCats: {},
};

var _buildCacheFromSearchResults = (categories)=>{
  return yelpSvc.search(null, categories).then((results)=>{
    // console.log('search results: ', JSON.stringify(results, null, 2));
    cache.search[categories] = results;
  });
}
var _updateCacheAggregates = (categories)=>{
  var catNdx = {};
  cache.search[categories].forEach(biz=>{
    biz.categories.forEach(c=>{
      if (!catNdx[c.alias]) catNdx[c.alias]={alias:c.alias, name:c.title, cnt:0};
      catNdx[c.alias].cnt++;
    });
  });
  // console.log('catNdx: ', catNdx);
  var cats = Object.keys(catNdx);
  cache.topCats[categories] = cats
        .map(k=>{return catNdx[k];})
        .sort((c1, c2) => {
          return c2.cnt - c1.cnt;
        })
        .slice(0, Math.min(cats.length, 10));
  // console.log('cache.topCats[categories]: ', cache.topCats[categories]);
}

var _searchAndAggregateFn = (cat) => {
    return ()=>{
      return _buildCacheFromSearchResults(cat)
        .then(()=>{
          _updateCacheAggregates(cat);
        });
    }
};
var buildCache = () => {
  var p = yelpSvc.init(lat, lon)
    .then(_searchAndAggregateFn('restaurants'));
  defaultCatsForCaching.forEach(c=>{
    p = p.then(_searchAndAggregateFn(c));
  });
  p.catch(e=>{
      console.log(e);
    });
};


var queryCat = (category) => {
  var p = Promise.resolve();
  if (!cache.topCats[category]) { // only checking 'topCats' since it is derived from 'search'
    p = p.then(_searchAndAggregateFn(category));
  }
  return p.then(()=>{
    return Promise.resolve({results: cache.search[category], facets: cache.topCats[category]});
  });
}
var sayTop = (response, category) => {
  if (catAliases[category]) category = catAliases[category];
  // console.log('sayTop request: ' + category);
  return queryCat(category).then(({results, facets})=>{
    // console.log('sayTop rcvd');
    if (results) response.say(`My favorite restaurant is ${results[0].name}`)
  });
}
var saySummary = (response, category) => {
  // console.log('saySummary request: ' + category);
  return queryCat(category).then(({results, facets})=>{
    // console.log('saySummary rcvd: ', facets);
    if (facets) {
      facets = facets.filter(c=>{return c.alias !== category;})
      response.say(`They are mostly ${facets[0].name}, ${facets[1].name}, and ${facets[2].name}`)
    }
  });
}

violet.respondTo(['display cache'],
  (response) => {
    console.log(JSON.stringify(cache, null, 2));
    response.say('done');
});

violet.respondTo(["clear cache"],
  (response) => {
    var keyNum = o => {return Object.keys(o).length;}
    response.say(`Cache used to have ${keyNum(cache.search)} search queries and ${keyNum(cache.topCats)} category metadata`);
    Object.keys(cache.search).forEach(t=>{
      if (t === 'restaurants') return;
      delete cache.search[t];
      delete cache.topCats[t];
    });
    response.say(`Cache updated to have ${keyNum(cache.search)} search queries and ${keyNum(cache.topCats)} category metadata`);
    // response.say(`cache.topCats[category] Cleared cache.`);
});

violet.respondTo(['what is your top {recommended|} restaurant'],
  (response) => {
    return sayTop(response, 'restaurants');
});

violet.respondTo(['what is your top {recommended|} [[category]] restaurant'],
  (response) => {
    var category = response.get('category')
    return sayTop(response, category);
});

violet.respondTo(['what restaurants would you recommend'],
  (response) => {
    response.say([
      'We have a number of restaurant that I like here.',
      'There are a number of great restaurant here.',
      'There are a number of popular restaurant here.',
    ]);
    return saySummary(response, 'restaurants');
    // response.addGoal('categoryOrTop');
});

violet.respondTo(['what [[category]] restaurants would you recommend'],
  (response) => {
    response.say([
      'We have a number of restaurant that I like here.',
      'There are a number of great restaurant here.',
      'There are a number of popular restaurant here.',
    ]);
    var category = response.get('category')
    return saySummary(response, category);
    // response.addGoal('categoryOrTop');
});

buildCache();
