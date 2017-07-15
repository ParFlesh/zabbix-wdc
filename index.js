(function () {
    var myConnector = tableau.makeConnector();
	
	if (!Object.assign) {
	  Object.defineProperty(Object, 'assign', {
		enumerable: false,
		configurable: true,
		writable: true,
		value: function(target) {
		  'use strict';
		  if (target === undefined || target === null) {
			throw new TypeError('Cannot convert first argument to object');
		  }

		  var to = Object(target);
		  for (var i = 1; i < arguments.length; i++) {
			var nextSource = arguments[i];
			if (nextSource === undefined || nextSource === null) {
			  continue;
			}
			nextSource = Object(nextSource);

			var keysArray = Object.keys(Object(nextSource));
			for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
			  var nextKey = keysArray[nextIndex];
			  var desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
			  if (desc !== undefined && desc.enumerable) {
				to[nextKey] = nextSource[nextKey];
			  }
			}
		  }
		  return to;
		}
	  });
	}

	var options = new Object();

    myConnector.getSchema = function (schemaCallback) {

		var data = JSON.parse(tableau.connectionData);
		
		var tables = [];
		
		parseApiCall = function(apiCall) {
			var table = {
				id:apiCall.id,
				alias:apiCall.alias,
				description:apiCall.description,
				columns:[]
			};
			
			var idRegex = /.*id/i;
			
			addColumns = function(method,filter) {
				//console.log(method,filter)
				 for (var ai = 0, keys = Object.keys(methods[method]), alen = keys.length; ai < alen; ai++) {
					 if (filter) {
						 //console.log('filter',filter.indexOf(methods[method][keys[ai]]),keys[ai])
						 if (filter.indexOf(keys[ai]) != -1 || keys[ai].match(idRegex)) {
							table.columns.push(methods[method][keys[ai]])
						 }
					 } else { 
						 table.columns.push(methods[method][keys[ai]])
					 };
				};
			};
			
			if (apiCall.params.output == 'extend') {
				addColumns(apiCall.method);
			} else if (Array.isArray(apiCall.params.output)) {
				addColumns(apiCall.method,apiCall.params.output);
			} else {
				addColumns(apiCall.method);
			};

			pKeys = Object.keys(apiCall.params)
			selectRegex = /^select(.*)/i;

			for (var pi = 0, plen = pKeys.length; pi < plen; pi++) {
				if (pKeys[pi].match(selectRegex)) {
					switch (apiCall.params[pKeys[pi]]) {
						case 'extend':
							addColumns(selectTranslate[pKeys[pi]]);
							break;
						default:
							addColumns(selectTranslate[pKeys[pi]],apiCall.params[pKeys[pi]]);
							break;
					}
				};
			};
 
			return table; 
		};
		
		for (var i = 0, len = data.apiCalls.length; i < len; i++) {
			tables.push(parseApiCall(data.apiCalls[i]));
		};

		schemaCallback(tables);
	};

    myConnector.getData = function (table, doneCallback) {

		mergeObject = function(array,object,subKey) {
			//console.log(array)
			var output = []; 
			new Promise(function(resolve,reject){
				for (var i = 0, len = array.length; i < len; i++) {
					output.push(Object.assign({},array[i],renameKeys(object,subKey)))
				};
				resolve(output)
			});
		};
		
		mergeArrays = function(a,b,subKey) {
			return Promise.all(a.map(function(aitem){
				return mergeObjectArray(aitem,b,subKey);
			})).then(function(res){return [].concat.apply([],res)});
		};

		mergeObjectArray = function(object,array,subKey) {
			return Promise.all(array.map(function(bitem){
				return renameKeys(bitem,subKey).then(function(res){return Object.assign({},object,res)})
			}));
		};

		renameKeys = function(object,subKey){
			var keys = Object.keys(object)
			var new_object = {};
			return Promise.all(keys.map(function(item){
					new_object[subKey+'_'+item] = object[item]
					return new_object;
			})).then(function(res){
				return Promise.resolve(new_object)
			})
		};

		addKey = function(array,key,value,subKey) {
			return array.reduce(function(promise,item) {
				return promise.then(function(result) {
					item[subKey+'_'+key] = value
					result.push(item)
					return result
				})
			},Promise.resolve([]))
		};

		flattenEntry = function(arr) {
			var iKeys = Object.keys(arr);
			 
			return iKeys.reduce(function(promise, item) {
				return promise.then(function(result) {
					if (Array.isArray(arr[item])) {
						return mergeArrays(result,arr[item],arrayTranslate[item])
                    } else if (typeof arr[item] == 'object') {
						return mergeObject(result,arr[item],item)
                    } else {
						return addKey(result,item,arr[item],'host');
                    }
				});        
			}, Promise.resolve([{}]));
		}
        
        var data = JSON.parse(tableau.connectionData);

        server = new jpZabbix(data);

		server.setAuth(data.auth)
		
		var apiCall = data.apiCalls.filter(function(a){return table.tableInfo.id == a.id})

		parseEntry = function(entry) {
			var output = flattenEntry(entry,apiCall[0].method);

			tableau.log(output)

			return output;
		};

		parseData = function (result) {
			return result.reduce(function(promise,item){
				return promise.then(function(result){
					return flattenEntry(item)
				})
			},Promise.all());
			
        }

		function workMyCollection(arr) {
			return Promise.all(arr.map(function(item) {
				return flattenEntry(item).then(table.appendRows);
			}));    
		}

		var call = server.api(apiCall[0].method+'.get',apiCall[0].params)
		call.then(workMyCollection).then().then(doneCallback).catch(errorMethod);
    };

    errorMethod = function(response) {
		new Promise(function(resolve,reject){
			tableau.log(response)
			resolve(response)
		});
    }

    setupConnector = function(callBack) {
        var apiOpts = {
            'url': document.getElementById('url').value,
            'user':document.getElementById('user').value,
            'password':document.getElementById('password').value
        };
		
		options.url = document.getElementById('url').value;   
		tableau.connectionName = document.getElementById('connectionName').value;

        server = new jpZabbix(apiOpts);
        server.init().then(server.getToken).then(authComplete).catch(errorMethod);
    };

    authComplete = function(token) {
		new Promise(function(resolve,reject){
			options.auth = token
			document.getElementById('connTabs').style.display = 'none';
			document.getElementById('apiTabs').style.display = null; 
			resolve(true)
		})
	};
	
	submitConnector = function() {
		options.apiCalls = [];  
		getAPICalls();
	};

	getAPICalls = function() {
        for (var i = 1; i <= counter; i++) {
            options.apiCalls.push({
				id:i.toString(),
				alias:document.getElementById('alias'+i).value,
				description:document.getElementById('description'+i).value,
				method:document.getElementById('method'+i).value,
				params:JSON.parse(document.getElementById('params'+i).value)
				});
        };
	
        tableau.connectionData = JSON.stringify(options);
        tableau.submit();
    };

    tableau.registerConnector(myConnector);

    var counter = 1;
    var limit = 3;
    addTab = function(){
          counter++;
          var newdiv = document.createElement('div')
		  newdiv.id = 'table'+counter+'Tab';
          document.getElementById('tableContainer').appendChild(newdiv);
		  var newdiv = document.getElementById('table'+counter+'Tab');
          newdiv.outerHTML = '<div id="table'+counter+'Tab" aria-labelledby="tab_table'+counter+'" class="ui-tabs-panel ui-widget-content ui-corner-bottom" role="tabpanel" aria-expanded="false" aria-hidden="true" style="display: none;"><ul class="table-forms"><li><div class="table-forms-td-left"><label for="alias'+counter+'div">Alias</label></div><div class="table-forms-td-right"><input type="text" id="alias'+counter+'" name="alias'+counter+'" value="Zabbix Hosts" maxlength="128" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="description'+counter+'div">Description</label></div><div class="table-forms-td-right"><input type="text" id="description'+counter+'" name="description'+counter+'" value="Zabbix Hosts" maxlength="128" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="method'+counter+'div">Method</label></div><div class="table-forms-td-right"><input type="text" id="method'+counter+'" name="method'+counter+'" value="host" maxlength="128" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="params'+counter+'div">Params</label></div><div class="table-forms-td-right"><input type="text" id="params'+counter+'" name="params'+counter+'" value="{}" maxlength="128" style="width: 453px;"></div></li></ul></div>';
		  
		  var newdiv = document.createElement('li');
		  newdiv.innerHTML = '<li class="ui-state-default ui-corner-top" role="tab" tabindex="'+counter+'" aria-controls="apiCall'+counter+'Tab" aria-labelledby="tab_table'+counter+'Tab" aria-selected="false"><a id="tab_table'+counter+'" onclick="changeTab(\'#table'+counter+'Tab\')" class="ui-tabs-anchor" role="presentation" tabindex="'+counter+'">API Call '+counter+'</a></li>'
		  document.getElementById('tabList').appendChild(newdiv);
     }
	 
	 changeTab = function(tabName) {
		 for (var i = 1, len = counter+1; i < len; i++) {
			 document.getElementById('#table'+i+'Tab').style.display = 'none'; 
		 };
		 document.getElementById(tabName).style.display = null;
	 };
	
	arrayTranslate = {
		'items':'item'
	}

	selectTranslate = {
		'selectItems': 'item',
		'selectGroups':'hostgroup'
	};

	methods = {
		action: {
			actionid: {
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'actionid',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Action ID',
				id:'action_actionid',
				numberFormat:tableau.numberFormatEnum.number
			},
			esc_period: {
				aggType:tableau.aggTypeEnum.sum,
				alias: 'esc_period',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Escalation Period',
				id:'action_esc_period',
				numberFormat:tableau.numberFormatEnum.number
			},
			eventsource:{
				aggType:tableau.aggTypeEnum.avg,
				alias: 'eventsource',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Event Source',
				id:'action_eventsource',
				numberFormat:tableau.numberFormatEnum.number
			}
		},
		host: {
			hostid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host.',
				id:'host_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			host:{
				alias: 'Host',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Technical name of the host.',
				id:'host_host' 
			},
			available:{
				alias: 'Available',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Availability of Zabbix agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			description:{
				alias: 'Description',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Description of the host.',
				id:'host_description' 
			},
			disable_until:{
				alias: 'Disable Until',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'The next polling time of an unavailable Zabbix agent.',
				id:'host:disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			error:{
				alias: 'Error',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if Zabbix agent is unavailable.',
				id:'host_error' 
			},
			errors_from:{
				alias: 'Errors From',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Time when Zabbix agent became unavailable.',
				id:'host_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			flags:{
				alias: 'Flags',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Origin of the host. \n\nPossible values: \n0 - a plain host; \n4 - a discovered host.',
				id:'host_flags',
				numberFormat:tableau.numberFormatEnum.number
			},
			inventory_mode:{
				alias: 'Inventory Mode',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Host inventory population mode. \n\nPossible values are: \n-1 - disabled; \n0 - (default) manual; \n1 - automatic.',
				id:'host_inventory_mode',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_authtype:{
				alias: 'IPMI Auth Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'IPMI authentication algorithm. \n\nPossible values are:\n-1 - (default) default; \n0 - none; \n1 - MD2; \n2 - MD5 \n4 - straight; \n5 - OEM; \n6 - RMCP+.',
				id:'host_ipmi_authtype',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_available:{
				alias: 'IPMI Available',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Availability of IPMI agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_ipmi_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_disable_until:{
				alias: 'IPMI Disable Until',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'The next polling time of an unavailable IPMI agent.',
				id:'host_ipmi_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_error:{
				alias: 'IPMI Error',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if IPMI agent is unavailable.',
				id:'host_ipmi_error' 
			} 
		},
		item:{
			itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Item ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the item.',
				id:'item_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			name:{
				alias: 'Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Technical name of the Item.',
				id:'item_name' 
			}
		}
	}
})();
