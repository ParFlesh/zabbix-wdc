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
			return Promise.all(array.map(function(item){
				return renameKeys(object,subKey).then(function(res){return  Object.assign({},item,res)})
			}))
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
						tableau.log(result)
						tableau.log(arr[item])
						tableau.log(item)
						return mergeObject(result,arr[item],item)
						//return result
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
		call.then(workMyCollection).then(doneCallback).catch(errorMethod);
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
		'groups':'hostgroup',
		'applications':'application',
		'discoveries':'discoveryrule',
		'discoveryRule':'drule',
		'graphs':'graph',
		'hostDiscovery':'hostdiscovery',
		'httpTests':'httptest',
		'interfaces':'hostinterface',
		'inventory':'inventory',
		'items':'item',
		'macros':'macro',
		'parentTemplates':'template',
		'screens':'screen',
		'triggers':'trigger'
	}

	selectTranslate = {
		'selectItems': 'item',
		'selectGroups':'hostgroup',
		'selectApplications':'application',
		'selectDiscoveries':'discoveryrule',
		'selectDiscoveryRule':'drule',
		'selectGraphs':'graph',
		'selectHostDiscovery':'drule',
		'selectHttpTests':' httptest',
		'selectInterfaces':'interface',
		'selectInventory':'inventory',
		'selectMacros':'macro',
		'selectParentTemplates':'template',
		'selectScreens':'screen',
		'selectTriggers':'trigger'
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
				id:'host_disable_until',
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
				dataType:tableau.dataTypeEnum.int,
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
			},
			ipmi_errors_from:{
				alias: 'IPMI Error From',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Time when IPMI agent became unavailable.',
				id:'host_ipmi_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_password:{
				alias: 'IPMI Password',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'IPMI password.',
				id:'host_ipmi_password' 
			},
			ipmi_privilege:{
				alias: 'IPMI Privilege level.',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'IPMI privilege level. \n\nPossible values are:\n1 - callback;\n2 - (default) user;\n3 - operator;\n4 - admin;\n5 - OEM.',
				id:'host_ipmi_privilege',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_username:{
				alias: 'IPMI username',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'IPMI username.',
				id:'host_ipmi_username' 
			},
			jmx_available:{
				alias: 'IPMI Privilege level',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Availability of JMX agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_jmx_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			jmx_disable_until:{
				alias: 'JMX Disable Until',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'The next polling time of an unavailable JMX agent.',
				id:'host_jmx_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			jmx_error:{
				alias: 'JMX Error',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if JMX agent is unavailable.',
				id:'host_jmx_error' 
			},
			jmx_errors_from:{
				alias: 'JMX Errors From',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Time when JMX agent became unavailable.',
				id:'host_jmx_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_from:{
				alias: 'Maintenance From',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Starting time of the effective maintenance.',
				id:'host_maintenance_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_status:{
				alias: 'Maintenance Status',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Effective maintenance status. \n\nPossible values are:\n0 - (default) no maintenance;\n1 - maintenance in effect.',
				id:'host_maintenance_status',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_type:{
				alias: 'Maintenance Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Effective maintenance type. \n\nPossible values are:\n0 - (default) maintenance with data collection;\n1 - maintenance without data collection.',
				id:'host_maintenance_type',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenanceid:{
				alias: 'Maintenance ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the maintenance that is currently in effect on the host.',
				id:'host_maintenanceid',
				numberFormat:tableau.numberFormatEnum.number
			},
			name:{
				alias: 'Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Visible name of the host. \n\nDefault: host property value.',
				id:'host_name' 
			},
			proxy_hostid:{
				alias: 'Proxy Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the proxy that is used to monitor the host.',
				id:'host_proxy_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_available:{
				alias: 'SNMP Available',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Availability of SNMP agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_snmp_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_disable_until:{
				alias: 'SNMP Disable Until',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'The next polling time of an unavailable SNMP agent.',
				id:'host_snmp_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_error:{
				alias: 'SNMP Error',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if SNMP agent is unavailable.',
				id:'host_snmp_error' 
			},
			snmp_errors_from:{
				alias: 'SNMP Errors From',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Time when SNMP agent became unavailable.',
				id:'host_snmp_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			status:{
				alias: 'Status',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Status and function of the host. \n\nPossible values are:\n0 - (default) monitored host;\n1 - unmonitored host.',
				id:'host_status',
				numberFormat:tableau.numberFormatEnum.number
			}
		},
		hostdiscovery:{
			host:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Host',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'host of the host prototype',
				id:'hostdiscovery_host',
				numberFormat:tableau.numberFormatEnum.number
			},
			hostid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the discovered host or host prototype',
				id:'hostdiscovery_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			parent_hostid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Parent Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host prototype from which the host has been created',
				id:'hostdiscovery_parent_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			parent_itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Parent Item ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the LLD rule that created the discovered host',
				id:'hostdiscovery_parent_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			lastcheck:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Last Check',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'time when the host was last discovered',
				id:'hostdiscovery_lastcheck',
				numberFormat:tableau.numberFormatEnum.number
			},
			ts_delete:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Timestamp Delete',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:' time when a host that is no longer discovered will be deleted',
				id:'hostdiscovery_ts_delete',
				numberFormat:tableau.numberFormatEnum.number
			}
		},
		inventory:{
			hostid:{
				alias: 'Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the Host.',
				id:'inventory_hostid' 
			},
			alias:{
				alias: 'Alias',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				id:'inventory_alias' 
			},
			asset_tag:{
				alias: 'Asset tag',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				id:'inventory_asset_tag' 
			},
			chassis:{
				alias: 'Chassis',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_chassis' 
			},
			contact:{
				alias: 'Contact person',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_contact' 
			},
			contact_number:{
				alias: 'Contact number',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_contact_number' 
			},
			date_hw_decomm:{
				alias: 'HW decommissioning date',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_decomm' 
			},
			date_hw_expiry:{
				alias: 'HW maintenance expiry date',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_expiry' 
			},
			date_hw_install:{
				alias: 'HW installation date',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_install' 
			},
			date_hw_purchase:{
				alias: 'HW purchase date',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_purchase' 
			},
			deployment_status:{
				alias: 'Deployment status',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_deployment_status' 
			},
			hardware:{
				alias: 'Hardware',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hardware_full' 
			},
			hardware_full:{
				alias: 'Detailed hardware',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hardware_full' 
			},
			host_netmask:{
				alias: 'Host subnet mask',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_netmask' 
			},
			host_networks:{
				alias: 'Host networks',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_networks' 
			},
			host_router:{
				alias: 'Host router',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_router' 
			},
			hw_arch:{
				alias: 'HW architecture',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hw_arch' 
			},
			installer_name:{
				alias: 'Installer name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_installer_name' 
			},
			location:{
				alias: 'Location',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location' 
			},
			location_lat:{
				alias: 'Location latitude',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location_lat' 
			},
			location_lon:{
				alias: 'Location longitude',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location_lon' 
			},
			macaddress_a:{
				alias: 'MAC address B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_macaddress_a' 
			},
			macaddress_b:{
				alias: 'MAC address B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_chassis' 
			},
			model:{
				alias: 'Model',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_model' 
			},
			name:{
				alias: 'Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_name' 
			},
			notes:{
				alias: 'Notes',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_notes' 
			},
			oob_ip:{
				alias: 'OOB IP address',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_ip' 
			},
			oob_netmask:{
				alias: 'OOB host subnet mask',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_netmask' 
			},
			oob_router:{
				alias: 'OOB router',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_router' 
			},
			os:{
				alias: 'OS name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os' 
			},
			os_full:{
				alias: 'Detailed OS name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os_full' 
			},
			os_short:{
				alias: 'Short OS name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os_short' 
			},
			poc_1_cell:{
				alias: 'Primary POC mobile number',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_cell' 
			},
			poc_1_email:{
				alias: 'Primary email',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_email' 
			},
			poc_1_name:{
				alias: 'Primary POC name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_name' 
			},
			poc_1_notes:{
				alias: 'Primary POC notes',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_notes' 
			},
			poc_1_phone_a:{
				alias: 'Primary POC phone A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_phone_a' 
			},
			poc_1_phone_b:{
				alias: 'Primary POC phone B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_phone_b' 
			},
			poc_1_screen:{
				alias: 'Primary POC screen name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_screen' 
			},
			poc_2_cell:{
				alias: 'Secondary POC mobile number',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_cell' 
			},
			poc_2_email:{
				alias: 'Secondary email',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_email' 
			},
			poc_2_name:{
				alias: 'Secondary POC name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_name' 
			},
			poc_2_notes:{
				alias: 'Secondary POC notes',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_notes' 
			},
			poc_2_phone_a:{
				alias: 'Secondary POC phone A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_phone_a' 
			},
			poc_2_phone_b:{
				alias: 'Secondary POC phone B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_phone_b' 
			},
			poc_2_screen:{
				alias: 'Secondary POC screen name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_screen' 
			},
			serialno_a:{
				alias: 'Serial number A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_serialno_a' 
			},
			site_address_a:{
				alias: 'Site address A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_a' 
			},
			site_address_b :{
				alias: 'Site address B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_b' 
			},
			site_address_c:{
				alias: 'Site address C',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_c' 
			},
			site_city:{
				alias: 'Site city',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_site_city' 
			},
			site_country:{
				alias: 'Site country',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_country' 
			},
			site_notes:{
				alias: 'Site notes',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_notes' 
			},
			site_rack:{
				alias: 'Site rack location',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_rack' 
			},
			site_state:{
				alias: 'Site state',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_state' 
			},
			site_zip:{
				alias: 'Site ZIP/postal code',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_zip' 
			},
			software:{
				alias: 'Software',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software' 
			},
			software_app_a:{
				alias: 'Software application A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_a' 
			},
			software_app_b:{
				alias: 'Software application B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_b' 
			},
			software_app_c:{
				alias: 'Software application C',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_c' 
			},
			software_app_d:{
				alias: 'Software application D',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_d' 
			},
			software_app_e:{
				alias: 'Software application E',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_e' 
			},
			software_full:{
				alias: 'Software details',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_full' 
			},
			tag:{
				alias: 'Tag',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_tag' 
			},
			type:{
				alias: 'Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_type' 
			},
			type_full:{
				alias: 'Type details',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_type_full' 
			},
			url_a:{
				alias: 'URL A',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_a' 
			},
			url_b:{
				alias: 'URL B',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_b' 
			},
			url_c:{
				alias: 'URL C',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_c' 
			},
			vendor:{
				alias: 'Vendor',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_vendor' 
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
			},
			delay:{
				alias: 'Delay',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Update interval of the item in seconds.',
				id:'item_delay',
			},
			hostid:{
				alias: 'Host ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host that the item belongs to.',
				id:'item_hostid',
			},
			interfaceid:{
				alias: 'Interface ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the item\'s host interface. Used only for host items. \n\nOptional for Zabbix agent (active), Zabbix internal, Zabbix trapper, Zabbix aggregate, database monitor and calculated items.',
				id:'item_interfaceid',
			},
			key_:{
				alias: 'Key',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Item key.',
				id:'item_key_' 
			},
			name:{
				alias: 'Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string ,
				description:'Name of the item.',
				id:'item_name'
			},
			type:{
				alias: 'Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Type of the item. \n\nPossible values: \n0 - Zabbix agent; \n1 - SNMPv1 agent; \n2 - Zabbix trapper; \n3 - simple check; \n4 - SNMPv2 agent; \n5 - Zabbix internal; \n6 - SNMPv3 agent; \n7 - Zabbix agent (active); \n8 - Zabbix aggregate; \n9 - web item; \n10 - external check; \n11 - database monitor; \n12 - IPMI agent; \n13 - SSH agent; \n14 - TELNET agent; \n15 - calculated; \n16 - JMX agent; \n17 - SNMP trap.',
				id:'item_type',
			},
			value_type:{
				alias: 'Value Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Type of information of the item. \n\nPossible values: \n0 - numeric float; \n1 - character; \n2 - log; \n3 - numeric unsigned; \n4 - text.',
				id:'item_value_type',
			},
			authtype:{
				alias: 'Auth Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'SSH authentication method. Used only by SSH agent items. \n\nPossible values: \n0 - (default) password; \n1 - public key.',
				id:'item_authtype',
			},
			data_type:{
				alias: 'Data Type',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Data type of the item. \n\nPossible values: \n0 - (default) decimal; \n1 - octal; \n2 - hexadecimal; \n3 - boolean.',
				id:'item_data_type',
			},
			delay_flex:{
				alias: 'Delay Flex',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Custom intervals that contain flexible intervals and scheduling intervals as serialized strings. \n\nMultiple intervals are separated by a semicolon.',
				id:'item_delay_flex',
			},
			delta:{
				alias: 'Delta',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Value that will be stored. \n\nPossible values: \n0 - (default) as is; \n1 - Delta, speed per second; \n2 - Delta, simple change.',
				id:'item_delta',
			},
			description:{
				alias: 'Description',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Description of the item.',
				id:'item_description',
			},
			error:{
				alias: 'Error',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Error text if there are problems updating the item.',
				id:'item_error',
			},
			flags:{
				alias: 'Flags',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int ,
				description:'Origin of the item. \n\nPossible values: \n0 - a plain item; \n4 - a discovered item.',
				id:'item_flags',
			},
			formula:{
				alias: 'Formula',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.float,
				description:'Custom multiplier. \n\nDefault: 1.',
				id:'item_formula',
			},
			history:{
				alias: 'History',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Number of days to keep item\'s history data. \n\nDefault: 90.',
				id:'item_history',
			},
			inventory_link:{
				alias: 'Inventory Link',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the host inventory field that is populated by the item. \n\nRefer to the host inventory page for a list of supported host inventory fields and their IDs. \n\nDefault: 0.',
				id:'item_inventory_link',
			},
			ipmi_sensor :{
				alias: 'IPMI Sensor',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'IPMI sensor. Used only by IPMI items.',
				id:'item_ipmi_sensor',
			},
			lastclock:{
				alias: 'Last Clock',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Time when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastclock',
			},
			lastns:{
				alias: 'LAst Nanosecond',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Nanoseconds when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastns',
			},
			lastns:{
				alias: 'Last Nanosecond',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Nanoseconds when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastns',
			},
			lastvalue:{
				alias: 'Last Value',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Last value of the item. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastvalue',
			},
			logtimefmt:{
				alias: 'Log Time Format',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Format of the time in log entries. Used only by log items.',
				id:'item_logtimefmt',
			},
			mtime:{
				alias: 'Modification Time',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Time when the monitored log file was last updated. Used only by log items.',
				id:'item_mtime',
			},
			multiplier:{
				alias: 'Custom Multiplier',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Whether to use a custom multiplier.',
				id:'item_multiplier',
			},
			params:{
				alias: 'Params',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Additional parameters depending on the type of the item: \n- executed script for SSH and Telnet items; \n- SQL query for database monitor items; \n- formula for calculated items.',
				id:'item_params',
			},
			password:{
				alias: 'Password',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Password for authentication. Used by simple check, SSH, Telnet, database monitor and JMX items.',
				id:'item_password',
			},
			port:{
				alias: 'Port',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Port monitored by the item. Used only by SNMP items.',
				id:'item_port',
			},
			prevvalue:{
				alias: 'Previous Value',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Previous value of the item. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_prevvalue',
			},
			privatekey:{
				alias: 'Private Key',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Name of the private key file.',
				id:'item_privatekey',
			},
			publickey:{
				alias: 'Public Key',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Name of the public key file.',
				id:'item_publickey',
			},
			snmp_community:{
				alias: 'SNMP Community String',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMP community. Used only by SNMPv1 and SNMPv2 items.',
				id:'item_snmp_community',
			},
			snmp_oid:{
				alias: 'SNMP OID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMP OID',
				id:'item_snmp_oid',
			},
			snmpv3_authpassphrase:{
				alias: 'SNMP v3 Auth Passphrase',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 auth passphrase. Used only by SNMPv3 items.',
				id:'item_snmpv3_authpassphrase',
			},
			snmpv3_authprotocol:{
				alias: 'SNMP v3 Auth Protocol',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 authentication protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) MD5; \n1 - SHA.',
				id:'item_snmpv3_authprotocol',
			},
			snmpv3_contextname:{
				alias: 'SNMP v3 Context Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 context name. Used only by SNMPv3 items.',
				id:'item_snmpv3_contextname',
			},
			snmpv3_privpassphrase:{
				alias: 'SNMP v3 Private Passphrase',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 priv passphrase. Used only by SNMPv3 items.',
				id:'item_snmpv3_privpassphrase',
			},
			snmpv3_privprotocol:{
				alias: 'SNMP v3 Priv Protocol',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 privacy protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) DES; \n1 - AES.',
				id:'item_snmpv3_privprotocol',
			},
			snmpv3_securitylevel:{
				alias: 'SNMP v3 Security Level',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 security level. Used only by SNMPv3 items. \n\nPossible values: \n0 - noAuthNoPriv; \n1 - authNoPriv; \n2 - authPriv.',
				id:'item_snmpv3_securitylevel',
			},
			snmpv3_securityname:{
				alias: 'SNMP v3 Security Name',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 security name. Used only by SNMPv3 items.',
				id:'item_snmpv3_securityname',
			},
			state:{
				alias: 'State',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'State of the item. \n\nPossible values: \n0 - (default) normal; \n1 - not supported.',
				id:'item_state',
			},
			status:{
				alias: 'Status',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Status of the item. \n\nPossible values: \n0 - (default) enabled item; \n1 - disabled item.',
				id:'item_status',
			},
			templateid:{
				alias: 'Template ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the parent template item.',
				id:'item_templateid',
			},
			trapper_hosts:{
				alias: 'Trapper Hosts',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Allowed hosts. Used only by trapper items.',
				id:'item_trapper_hosts',
			},
			trends:{
				alias: 'Trends',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'Number of days to keep item\'s trends data. \n\nDefault: 365.',
				id:'item_trends',
			},
			units:{
				alias: 'Units',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Value units.',
				id:'item_units',
			},
			username:{
				alias: 'Username',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.string,
				description:'Username for authentication. Used by simple check, SSH, Telnet, database monitor and JMX items. \n\nRequired by SSH and Telnet items.',
				id:'item_username',
			},
			valuemapid:{
				alias: 'Value Map ID',
				columnRole:tableau.columnRoleEnum.dimension,
				columnType:tableau.columnTypeEnum.discrete,
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the associated value map.',
				id:'item_valuemapid',
			}
		}
	}
})();
