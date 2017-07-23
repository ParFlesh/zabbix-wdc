(function () {
    var myConnector = tableau.makeConnector();
	
	errorMethod = function(response) {
		tableau.abortWithError(JSON.stringify(response))
    }
	
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
			var jobs = [];
			
			var table = {
				id:apiCall.id,
				alias:apiCall.alias,
				description:apiCall.description,
				columns:[]
			};
			
			var idRegex = /.*id/i;
			
			addColumns = function(method,filter) {
				return Promise.all(Object.keys(methods[method]).map(function(entry){
					if (filter) {
						 if (filter.indexOf(entry) != -1 || entry.match(idRegex)) {
							 var col = Object.assign({},{columnRole:tableau.columnRoleEnum.dimension,columnType:tableau.columnTypeEnum.discrete},methods[method][entry])
							 col.id = table.id+'_'+col.id
							table.columns.push(col)
						 }
					 } else { 
						var col = Object.assign({},{columnRole:tableau.columnRoleEnum.dimension,columnType:tableau.columnTypeEnum.discrete},methods[method][entry])
						 col.id = table.id+'_'+col.id
						 table.columns.push(col)
					 };
					 
				}))
			};
			
			if (apiCall.params.output == 'extend') {
				jobs.push(addColumns(apiCall.method));
			} else if (Array.isArray(apiCall.params.output)) {
				jobs.push(addColumns(apiCall.method,apiCall.params.output));
			} else {
				jobs.push(addColumns(apiCall.method));
			};

			pKeys = Object.keys(apiCall.params)
			selectRegex = /^select(.*)/i;

			for (var pi = 0, plen = pKeys.length; pi < plen; pi++) {
				if (pKeys[pi].match(selectRegex)) {
					switch (apiCall.params[pKeys[pi]]) {
						case 'extend':
							jobs.push(addColumns(selectTranslate[pKeys[pi]]));
							break;
						default:
							jobs.push(addColumns(selectTranslate[pKeys[pi]],apiCall.params[pKeys[pi]]));
							break;
					}
				};
			};
 
			return Promise.all(jobs).then(function(res){return table}); 
		};   
		
		genTables = function(array) {
			return Promise.all(array.map(function(entry){
				return parseApiCall(entry)
			})).then(function(tables){return tables})
		};

		genTables(data.apiCalls).then(schemaCallback);
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
					new_object[table.tableInfo.id+'_'+subKey+'_'+item] = object[item]
					return new_object;
			})).then(function(res){
				return Promise.resolve(new_object)
			})
		};

		addKey = function(array,key,value,subKey) {
			return array.reduce(function(promise,item) {
				return promise.then(function(result) {
					item[table.tableInfo.id+'_'+subKey+'_'+key] = value
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
						if (arr[item].length > 0) {
							return mergeArrays(result,arr[item],arrayTranslate[item])
						} else {
							return Promise.resolve(result);
						};
                    } else if (typeof arr[item] == 'object') {
						return mergeObject(result,arr[item],item)
                    } else {
						return addKey(result,item,arr[item],apiCall[0].method);
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

			return output;
		};

		parseData = function (result) {
			return result.reduce(function(promise,item){
				return promise.then(function(result){
					return flattenEntry(item)
				})
			},Promise.all());
			
        }
		
		appendRows = function(result){
			if (tableau.reportProgress) {tableau.reportProgress('Appending '+result.length+' rows')}
			table.appendRows(result)
		}

		function workMyCollection(arr) {
			if (tableau.reportProgress) {tableau.reportProgress('Completed '+apiCall[0].method+' API Call')}
			return Promise.all(arr.map(function(item) {
				return flattenEntry(item).then(table.appendRows);
			}));    
		}

		if (tableau.reportProgress) {tableau.reportProgress('Making '+apiCall[0].method+' API call')}
		var call = server.api(apiCall[0].method+'.get',apiCall[0].params)
		call.then(workMyCollection).then(doneCallback).catch(errorMethod);
    };

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
          newdiv.outerHTML = '<div id="table'+counter+'Tab" aria-labelledby="tab_table'+counter+'" class="ui-tabs-panel ui-widget-content ui-corner-bottom" role="tabpanel" aria-expanded="false" aria-hidden="true" style="display: none;"><ul class="table-forms"><li><div class="table-forms-td-left"><label for="alias'+counter+'div">Alias</label></div><div class="table-forms-td-right"><input type="text" id="alias'+counter+'" name="alias'+counter+'" value="Zabbix Hosts" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="description'+counter+'div">Description</label></div><div class="table-forms-td-right"><input type="text" id="description'+counter+'" name="description'+counter+'" value="Zabbix Hosts" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="method'+counter+'div">Table</label></div><div class="table-forms-td-right"><input type="text" id="method'+counter+'" name="method'+counter+'" value="host" style="width: 453px;"></div></li><li><div class="table-forms-td-left"><label for="params'+counter+'div">Params</label></div><div class="table-forms-td-right"><input type="text" id="params'+counter+'" name="params'+counter+'" value="{}" style="width: 453px;"></div></li></ul></div>';
		  
		  var newdiv = document.createElement('li');
		  newdiv.innerHTML = '<li class="ui-state-default ui-corner-top" role="tab" tabindex="'+counter+'" aria-controls="apiCall'+counter+'Tab" aria-labelledby="tab_table'+counter+'Tab" aria-selected="false"><a id="tab_table'+counter+'" onclick="changeTab(\'table'+counter+'Tab\')" class="ui-tabs-anchor" role="presentation" tabindex="'+counter+'">API Call '+counter+'</a></li>'
		  document.getElementById('tabList').appendChild(newdiv);
     }
	 
	 changeTab = function(tabName) {
		 for (var i = 1, len = counter+1; i < len; i++) {
			 document.getElementById('table'+i+'Tab').style.display = 'none'; 
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
		'triggers':'trigger',
		'hosts':'host',
		'itemDiscovery':'itemdiscovery',
		'acknowledges':'acknowledges'
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
		'selectTriggers':'trigger',
		'selectHosts':'host',
		'selectItemDiscovery':'discoveryrule',
		'select_acknowledges':'acknowledges'
	};

	methods = {
		action: {
			actionid: {
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'actionid',
				dataType:tableau.dataTypeEnum.int ,
				description:'Action ID',
				id:'action_actionid',
				numberFormat:tableau.numberFormatEnum.number
			},
			esc_period: {
				aggType:tableau.aggTypeEnum.sum,
				alias: 'esc_period',
				dataType:tableau.dataTypeEnum.int ,
				description:'Escalation Period',
				id:'action_esc_period',
				numberFormat:tableau.numberFormatEnum.number
			},
			eventsource:{
				aggType:tableau.aggTypeEnum.avg,
				alias: 'eventsource',
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
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host.',
				id:'host_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			host:{
				alias: 'Host',
				dataType:tableau.dataTypeEnum.string ,
				description:'Technical name of the host.',
				id:'host_host' 
			},
			available:{
				alias: 'Available',
				dataType:tableau.dataTypeEnum.int ,
				description:'Availability of Zabbix agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			description:{
				alias: 'Description',
				dataType:tableau.dataTypeEnum.string ,
				description:'Description of the host.',
				id:'host_description' 
			},
			disable_until:{
				alias: 'Disable Until',
				dataType:tableau.dataTypeEnum.int ,
				description:'The next polling time of an unavailable Zabbix agent.',
				id:'host_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			error:{
				alias: 'Error',
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if Zabbix agent is unavailable.',
				id:'host_error' 
			},
			errors_from:{
				alias: 'Errors From',
				dataType:tableau.dataTypeEnum.int ,
				description:'Time when Zabbix agent became unavailable.',
				id:'host_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			flags:{
				alias: 'Flags',
				dataType:tableau.dataTypeEnum.int ,
				description:'Origin of the host. \n\nPossible values: \n0 - a plain host; \n4 - a discovered host.',
				id:'host_flags',
				numberFormat:tableau.numberFormatEnum.number
			},
			inventory_mode:{
				alias: 'Inventory Mode',
				dataType:tableau.dataTypeEnum.int ,
				description:'Host inventory population mode. \n\nPossible values are: \n-1 - disabled; \n0 - (default) manual; \n1 - automatic.',
				id:'host_inventory_mode',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_authtype:{
				alias: 'IPMI Auth Type',
				dataType:tableau.dataTypeEnum.int ,
				description:'IPMI authentication algorithm. \n\nPossible values are:\n-1 - (default) default; \n0 - none; \n1 - MD2; \n2 - MD5 \n4 - straight; \n5 - OEM; \n6 - RMCP+.',
				id:'host_ipmi_authtype',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_available:{
				alias: 'IPMI Available',
				dataType:tableau.dataTypeEnum.int ,
				description:'Availability of IPMI agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_ipmi_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_disable_until:{
				alias: 'IPMI Disable Until',
				dataType:tableau.dataTypeEnum.int,
				description:'The next polling time of an unavailable IPMI agent.',
				id:'host_ipmi_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_error:{
				alias: 'IPMI Error',
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if IPMI agent is unavailable.',
				id:'host_ipmi_error' 
			},
			ipmi_errors_from:{
				alias: 'IPMI Error From',
				dataType:tableau.dataTypeEnum.int,
				description:'Time when IPMI agent became unavailable.',
				id:'host_ipmi_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_password:{
				alias: 'IPMI Password',
				dataType:tableau.dataTypeEnum.string ,
				description:'IPMI password.',
				id:'host_ipmi_password' 
			},
			ipmi_privilege:{
				alias: 'IPMI Privilege level.',
				dataType:tableau.dataTypeEnum.int,
				description:'IPMI privilege level. \n\nPossible values are:\n1 - callback;\n2 - (default) user;\n3 - operator;\n4 - admin;\n5 - OEM.',
				id:'host_ipmi_privilege',
				numberFormat:tableau.numberFormatEnum.number
			},
			ipmi_username:{
				alias: 'IPMI username',
				dataType:tableau.dataTypeEnum.string ,
				description:'IPMI username.',
				id:'host_ipmi_username' 
			},
			jmx_available:{
				alias: 'IPMI Privilege level',
				dataType:tableau.dataTypeEnum.int,
				description:'Availability of JMX agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_jmx_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			jmx_disable_until:{
				alias: 'JMX Disable Until',
				dataType:tableau.dataTypeEnum.int,
				description:'The next polling time of an unavailable JMX agent.',
				id:'host_jmx_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			jmx_error:{
				alias: 'JMX Error',
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if JMX agent is unavailable.',
				id:'host_jmx_error' 
			},
			jmx_errors_from:{
				alias: 'JMX Errors From',
				dataType:tableau.dataTypeEnum.int,
				description:'Time when JMX agent became unavailable.',
				id:'host_jmx_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_from:{
				alias: 'Maintenance From',
				dataType:tableau.dataTypeEnum.int,
				description:'Starting time of the effective maintenance.',
				id:'host_maintenance_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_status:{
				alias: 'Maintenance Status',
				dataType:tableau.dataTypeEnum.int,
				description:'Effective maintenance status. \n\nPossible values are:\n0 - (default) no maintenance;\n1 - maintenance in effect.',
				id:'host_maintenance_status',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenance_type:{
				alias: 'Maintenance Type',
				dataType:tableau.dataTypeEnum.int,
				description:'Effective maintenance type. \n\nPossible values are:\n0 - (default) maintenance with data collection;\n1 - maintenance without data collection.',
				id:'host_maintenance_type',
				numberFormat:tableau.numberFormatEnum.number
			},
			maintenanceid:{
				alias: 'Maintenance ID',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the maintenance that is currently in effect on the host.',
				id:'host_maintenanceid',
				numberFormat:tableau.numberFormatEnum.number
			},
			name:{
				alias: 'Name',
				dataType:tableau.dataTypeEnum.string ,
				description:'Visible name of the host. \n\nDefault: host property value.',
				id:'host_name' 
			},
			proxy_hostid:{
				alias: 'Proxy Host ID',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the proxy that is used to monitor the host.',
				id:'host_proxy_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_available:{
				alias: 'SNMP Available',
				dataType:tableau.dataTypeEnum.int,
				description:'Availability of SNMP agent. \n\nPossible values are:\n0 - (default) unknown;\n1 - available;\n2 - unavailable.',
				id:'host_snmp_available',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_disable_until:{
				alias: 'SNMP Disable Until',
				dataType:tableau.dataTypeEnum.int,
				description:'The next polling time of an unavailable SNMP agent.',
				id:'host_snmp_disable_until',
				numberFormat:tableau.numberFormatEnum.number
			},
			snmp_error:{
				alias: 'SNMP Error',
				dataType:tableau.dataTypeEnum.string ,
				description:'Error text if SNMP agent is unavailable.',
				id:'host_snmp_error' 
			},
			snmp_errors_from:{
				alias: 'SNMP Errors From',
				dataType:tableau.dataTypeEnum.int,
				description:'Time when SNMP agent became unavailable.',
				id:'host_snmp_errors_from',
				numberFormat:tableau.numberFormatEnum.number
			},
			status:{
				alias: 'Status',
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
				dataType:tableau.dataTypeEnum.string ,
				description:'host of the host prototype',
				id:'hostdiscovery_host',
				numberFormat:tableau.numberFormatEnum.number
			},
			hostid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Host ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the discovered host or host prototype',
				id:'hostdiscovery_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			parent_hostid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Parent Host ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host prototype from which the host has been created',
				id:'hostdiscovery_parent_hostid',
				numberFormat:tableau.numberFormatEnum.number
			},
			parent_itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Parent Item ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the LLD rule that created the discovered host',
				id:'hostdiscovery_parent_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			lastcheck:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Last Check',
				dataType:tableau.dataTypeEnum.int ,
				description:'time when the host was last discovered',
				id:'hostdiscovery_lastcheck',
				numberFormat:tableau.numberFormatEnum.number
			},
			ts_delete:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Timestamp Delete',
				dataType:tableau.dataTypeEnum.int ,
				description:' time when a host that is no longer discovered will be deleted',
				id:'hostdiscovery_ts_delete',
				numberFormat:tableau.numberFormatEnum.number
			}
		},
		itemdiscovery:{
			itemdiscoveryid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Item Discovery ID',
				dataType:tableau.dataTypeEnum.string ,
				description:'ID of the item discovery',
				id:'itemdiscovery_itemdiscoveryid',
				numberFormat:tableau.numberFormatEnum.number
			},
			itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Item ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the discovered item',
				id:'itemdiscovery_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			parent_itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Parent Item ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the item prototype from which the item has been created',
				id:'itemdiscovery_parent_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			key_:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Key',
				dataType:tableau.dataTypeEnum.int ,
				description:'key of the item prototype',
				id:'itemdiscovery_key_',
				numberFormat:tableau.numberFormatEnum.number
			},
			lastcheck:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Last Check',
				dataType:tableau.dataTypeEnum.int ,
				description:'time when the item was last discovered',
				id:'itemdiscovery_lastcheck',
				numberFormat:tableau.numberFormatEnum.number
			},
			ts_delete:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Timestamp Delete',
				dataType:tableau.dataTypeEnum.int ,
				description:' time when a item that is no longer discovered will be deleted',
				id:'itemdiscovery_ts_delete',
				numberFormat:tableau.numberFormatEnum.number
			}
		},
		inventory:{
			hostid:{
				alias: 'Host ID',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the Host.',
				id:'inventory_hostid' 
			},
			alias:{
				alias: 'Alias',
				dataType:tableau.dataTypeEnum.string ,
				id:'inventory_alias' 
			},
			asset_tag:{
				alias: 'Asset tag',
				dataType:tableau.dataTypeEnum.string ,
				id:'inventory_asset_tag' 
			},
			chassis:{
				alias: 'Chassis',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_chassis' 
			},
			contact:{
				alias: 'Contact person',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_contact' 
			},
			contact_number:{
				alias: 'Contact number',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_contact_number' 
			},
			date_hw_decomm:{
				alias: 'HW decommissioning date',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_decomm' 
			},
			date_hw_expiry:{
				alias: 'HW maintenance expiry date',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_expiry' 
			},
			date_hw_install:{
				alias: 'HW installation date',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_install' 
			},
			date_hw_purchase:{
				alias: 'HW purchase date',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_date_hw_purchase' 
			},
			deployment_status:{
				alias: 'Deployment status',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_deployment_status' 
			},
			hardware:{
				alias: 'Hardware',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hardware_full' 
			},
			hardware_full:{
				alias: 'Detailed hardware',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hardware_full' 
			},
			host_netmask:{
				alias: 'Host subnet mask',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_netmask' 
			},
			host_networks:{
				alias: 'Host networks',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_networks' 
			},
			host_router:{
				alias: 'Host router',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_host_router' 
			},
			hw_arch:{
				alias: 'HW architecture',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_hw_arch' 
			},
			installer_name:{
				alias: 'Installer name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_installer_name' 
			},
			location:{
				alias: 'Location',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location' 
			},
			location_lat:{
				alias: 'Location latitude',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location_lat' 
			},
			location_lon:{
				alias: 'Location longitude',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_location_lon' 
			},
			macaddress_a:{
				alias: 'MAC address B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_macaddress_a' 
			},
			macaddress_b:{
				alias: 'MAC address B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_chassis' 
			},
			model:{
				alias: 'Model',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_model' 
			},
			name:{
				alias: 'Name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_name' 
			},
			notes:{
				alias: 'Notes',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_notes' 
			},
			oob_ip:{
				alias: 'OOB IP address',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_ip' 
			},
			oob_netmask:{
				alias: 'OOB host subnet mask',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_netmask' 
			},
			oob_router:{
				alias: 'OOB router',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_oob_router' 
			},
			os:{
				alias: 'OS name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os' 
			},
			os_full:{
				alias: 'Detailed OS name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os_full' 
			},
			os_short:{
				alias: 'Short OS name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_os_short' 
			},
			poc_1_cell:{
				alias: 'Primary POC mobile number',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_cell' 
			},
			poc_1_email:{
				alias: 'Primary email',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_email' 
			},
			poc_1_name:{
				alias: 'Primary POC name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_name' 
			},
			poc_1_notes:{
				alias: 'Primary POC notes',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_notes' 
			},
			poc_1_phone_a:{
				alias: 'Primary POC phone A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_phone_a' 
			},
			poc_1_phone_b:{
				alias: 'Primary POC phone B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_phone_b' 
			},
			poc_1_screen:{
				alias: 'Primary POC screen name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_1_screen' 
			},
			poc_2_cell:{
				alias: 'Secondary POC mobile number',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_cell' 
			},
			poc_2_email:{
				alias: 'Secondary email',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_email' 
			},
			poc_2_name:{
				alias: 'Secondary POC name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_name' 
			},
			poc_2_notes:{
				alias: 'Secondary POC notes',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_notes' 
			},
			poc_2_phone_a:{
				alias: 'Secondary POC phone A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_phone_a' 
			},
			poc_2_phone_b:{
				alias: 'Secondary POC phone B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_phone_b' 
			},
			poc_2_screen:{
				alias: 'Secondary POC screen name',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_poc_2_screen' 
			},
			serialno_a:{
				alias: 'Serial number A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_serialno_a' 
			},
			site_address_a:{
				alias: 'Site address A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_a' 
			},
			site_address_b :{
				alias: 'Site address B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_b' 
			},
			site_address_c:{
				alias: 'Site address C',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_address_c' 
			},
			site_city:{
				alias: 'Site city',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_site_city' 
			},
			site_country:{
				alias: 'Site country',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_country' 
			},
			site_notes:{
				alias: 'Site notes',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_notes' 
			},
			site_rack:{
				alias: 'Site rack location',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_rack' 
			},
			site_state:{
				alias: 'Site state',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_state' 
			},
			site_zip:{
				alias: 'Site ZIP/postal code',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_site_zip' 
			},
			software:{
				alias: 'Software',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software' 
			},
			software_app_a:{
				alias: 'Software application A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_a' 
			},
			software_app_b:{
				alias: 'Software application B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_b' 
			},
			software_app_c:{
				alias: 'Software application C',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_c' 
			},
			software_app_d:{
				alias: 'Software application D',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_d' 
			},
			software_app_e:{
				alias: 'Software application E',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_app_e' 
			},
			software_full:{
				alias: 'Software details',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_software_full' 
			},
			tag:{
				alias: 'Tag',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_tag' 
			},
			type:{
				alias: 'Type',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_type' 
			},
			type_full:{
				alias: 'Type details',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_type_full' 
			},
			url_a:{
				alias: 'URL A',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_a' 
			},
			url_b:{
				alias: 'URL B',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_b' 
			},
			url_c:{
				alias: 'URL C',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_url_c' 
			},
			vendor:{
				alias: 'Vendor',
				dataType:tableau.dataTypeEnum.string,
				id:'inventory_vendor' 
			}
		},
		item:{
			itemid:{
				aggType:tableau.aggTypeEnum.count_dist,
				alias: 'Item ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the item.',
				id:'item_itemid',
				numberFormat:tableau.numberFormatEnum.number
			},
			name:{
				alias: 'Name',
				dataType:tableau.dataTypeEnum.string ,
				description:'Technical name of the Item.',
				id:'item_name' 
			},
			delay:{
				alias: 'Delay',
				dataType:tableau.dataTypeEnum.int ,
				description:'Update interval of the item in seconds.',
				id:'item_delay',
			},
			hostid:{
				alias: 'Host ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the host that the item belongs to.',
				id:'item_hostid',
			},
			interfaceid:{
				alias: 'Interface ID',
				dataType:tableau.dataTypeEnum.int ,
				description:'ID of the item\'s host interface. Used only for host items. \n\nOptional for Zabbix agent (active), Zabbix internal, Zabbix trapper, Zabbix aggregate, database monitor and calculated items.',
				id:'item_interfaceid',
			},
			key_:{
				alias: 'Key',
				dataType:tableau.dataTypeEnum.string ,
				description:'Item key.',
				id:'item_key_' 
			},
			name:{
				alias: 'Name',
				dataType:tableau.dataTypeEnum.string ,
				description:'Name of the item.',
				id:'item_name'
			},
			type:{
				alias: 'Type',
				dataType:tableau.dataTypeEnum.int ,
				description:'Type of the item. \n\nPossible values: \n0 - Zabbix agent; \n1 - SNMPv1 agent; \n2 - Zabbix trapper; \n3 - simple check; \n4 - SNMPv2 agent; \n5 - Zabbix internal; \n6 - SNMPv3 agent; \n7 - Zabbix agent (active); \n8 - Zabbix aggregate; \n9 - web item; \n10 - external check; \n11 - database monitor; \n12 - IPMI agent; \n13 - SSH agent; \n14 - TELNET agent; \n15 - calculated; \n16 - JMX agent; \n17 - SNMP trap.',
				id:'item_type',
			},
			value_type:{
				alias: 'Value Type',
				dataType:tableau.dataTypeEnum.int ,
				description:'Type of information of the item. \n\nPossible values: \n0 - numeric float; \n1 - character; \n2 - log; \n3 - numeric unsigned; \n4 - text.',
				id:'item_value_type',
			},
			authtype:{
				alias: 'Auth Type',
				dataType:tableau.dataTypeEnum.int ,
				description:'SSH authentication method. Used only by SSH agent items. \n\nPossible values: \n0 - (default) password; \n1 - public key.',
				id:'item_authtype',
			},
			data_type:{
				alias: 'Data Type',
				dataType:tableau.dataTypeEnum.int ,
				description:'Data type of the item. \n\nPossible values: \n0 - (default) decimal; \n1 - octal; \n2 - hexadecimal; \n3 - boolean.',
				id:'item_data_type',
			},
			delay_flex:{
				alias: 'Delay Flex',
				dataType:tableau.dataTypeEnum.string,
				description:'Custom intervals that contain flexible intervals and scheduling intervals as serialized strings. \n\nMultiple intervals are separated by a semicolon.',
				id:'item_delay_flex',
			},
			delta:{
				alias: 'Delta',
				dataType:tableau.dataTypeEnum.int ,
				description:'Value that will be stored. \n\nPossible values: \n0 - (default) as is; \n1 - Delta, speed per second; \n2 - Delta, simple change.',
				id:'item_delta',
			},
			description:{
				alias: 'Description',
				dataType:tableau.dataTypeEnum.string,
				description:'Description of the item.',
				id:'item_description',
			},
			error:{
				alias: 'Error',
				dataType:tableau.dataTypeEnum.string,
				description:'Error text if there are problems updating the item.',
				id:'item_error',
			},
			flags:{
				alias: 'Flags',
				dataType:tableau.dataTypeEnum.int ,
				description:'Origin of the item. \n\nPossible values: \n0 - a plain item; \n4 - a discovered item.',
				id:'item_flags',
			},
			formula:{
				alias: 'Formula',
				dataType:tableau.dataTypeEnum.float,
				description:'Custom multiplier. \n\nDefault: 1.',
				id:'item_formula',
			},
			history:{
				alias: 'History',
				dataType:tableau.dataTypeEnum.int,
				description:'Number of days to keep item\'s history data. \n\nDefault: 90.',
				id:'item_history',
			},
			inventory_link:{
				alias: 'Inventory Link',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the host inventory field that is populated by the item. \n\nRefer to the host inventory page for a list of supported host inventory fields and their IDs. \n\nDefault: 0.',
				id:'item_inventory_link',
			},
			ipmi_sensor :{
				alias: 'IPMI Sensor',
				dataType:tableau.dataTypeEnum.string,
				description:'IPMI sensor. Used only by IPMI items.',
				id:'item_ipmi_sensor',
			},
			lastclock:{
				alias: 'Last Clock',
				dataType:tableau.dataTypeEnum.int,
				description:'Time when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastclock',
			},
			lastns:{
				alias: 'LAst Nanosecond',
				dataType:tableau.dataTypeEnum.int,
				description:'Nanoseconds when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastns',
			},
			lastns:{
				alias: 'Last Nanosecond',
				dataType:tableau.dataTypeEnum.int,
				description:'Nanoseconds when the item was last updated. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastns',
			},
			lastvalue:{
				alias: 'Last Value',
				dataType:tableau.dataTypeEnum.string,
				description:'Last value of the item. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_lastvalue',
			},
			logtimefmt:{
				alias: 'Log Time Format',
				dataType:tableau.dataTypeEnum.string,
				description:'Format of the time in log entries. Used only by log items.',
				id:'item_logtimefmt',
			},
			mtime:{
				alias: 'Modification Time',
				dataType:tableau.dataTypeEnum.int,
				description:'Time when the monitored log file was last updated. Used only by log items.',
				id:'item_mtime',
			},
			multiplier:{
				alias: 'Custom Multiplier',
				dataType:tableau.dataTypeEnum.int,
				description:'Whether to use a custom multiplier.',
				id:'item_multiplier',
			},
			params:{
				alias: 'Params',
				dataType:tableau.dataTypeEnum.string,
				description:'Additional parameters depending on the type of the item: \n- executed script for SSH and Telnet items; \n- SQL query for database monitor items; \n- formula for calculated items.',
				id:'item_params',
			},
			password:{
				alias: 'Password',
				dataType:tableau.dataTypeEnum.string,
				description:'Password for authentication. Used by simple check, SSH, Telnet, database monitor and JMX items.',
				id:'item_password',
			},
			port:{
				alias: 'Port',
				dataType:tableau.dataTypeEnum.string,
				description:'Port monitored by the item. Used only by SNMP items.',
				id:'item_port',
			},
			prevvalue:{
				alias: 'Previous Value',
				dataType:tableau.dataTypeEnum.string,
				description:'Previous value of the item. \n\nThis property will only return a value for the period configured in ZBX_HISTORY_PERIOD.',
				id:'item_prevvalue',
			},
			privatekey:{
				alias: 'Private Key',
				dataType:tableau.dataTypeEnum.string,
				description:'Name of the private key file.',
				id:'item_privatekey',
			},
			publickey:{
				alias: 'Public Key',
				dataType:tableau.dataTypeEnum.string,
				description:'Name of the public key file.',
				id:'item_publickey',
			},
			snmp_community:{
				alias: 'SNMP Community String',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMP community. Used only by SNMPv1 and SNMPv2 items.',
				id:'item_snmp_community',
			},
			snmp_oid:{
				alias: 'SNMP OID',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMP OID',
				id:'item_snmp_oid',
			},
			snmpv3_authpassphrase:{
				alias: 'SNMP v3 Auth Passphrase',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 auth passphrase. Used only by SNMPv3 items.',
				id:'item_snmpv3_authpassphrase',
			},
			snmpv3_authprotocol:{
				alias: 'SNMP v3 Auth Protocol',
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 authentication protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) MD5; \n1 - SHA.',
				id:'item_snmpv3_authprotocol',
			},
			snmpv3_contextname:{
				alias: 'SNMP v3 Context Name',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 context name. Used only by SNMPv3 items.',
				id:'item_snmpv3_contextname',
			},
			snmpv3_privpassphrase:{
				alias: 'SNMP v3 Private Passphrase',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 priv passphrase. Used only by SNMPv3 items.',
				id:'item_snmpv3_privpassphrase',
			},
			snmpv3_privprotocol:{
				alias: 'SNMP v3 Priv Protocol',
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 privacy protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) DES; \n1 - AES.',
				id:'item_snmpv3_privprotocol',
			},
			snmpv3_securitylevel:{
				alias: 'SNMP v3 Security Level',
				dataType:tableau.dataTypeEnum.int,
				description:'SNMPv3 security level. Used only by SNMPv3 items. \n\nPossible values: \n0 - noAuthNoPriv; \n1 - authNoPriv; \n2 - authPriv.',
				id:'item_snmpv3_securitylevel',
			},
			snmpv3_securityname:{
				alias: 'SNMP v3 Security Name',
				dataType:tableau.dataTypeEnum.string,
				description:'SNMPv3 security name. Used only by SNMPv3 items.',
				id:'item_snmpv3_securityname',
			},
			state:{
				alias: 'State',
				dataType:tableau.dataTypeEnum.int,
				description:'State of the item. \n\nPossible values: \n0 - (default) normal; \n1 - not supported.',
				id:'item_state',
			},
			status:{
				alias: 'Status',
				dataType:tableau.dataTypeEnum.int,
				description:'Status of the item. \n\nPossible values: \n0 - (default) enabled item; \n1 - disabled item.',
				id:'item_status',
			},
			templateid:{
				alias: 'Template ID',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the parent template item.',
				id:'item_templateid',
			},
			trapper_hosts:{
				alias: 'Trapper Hosts',
				dataType:tableau.dataTypeEnum.string,
				description:'Allowed hosts. Used only by trapper items.',
				id:'item_trapper_hosts',
			},
			trends:{
				alias: 'Trends',
				dataType:tableau.dataTypeEnum.int,
				description:'Number of days to keep item\'s trends data. \n\nDefault: 365.',
				id:'item_trends',
			},
			units:{
				alias: 'Units',
				dataType:tableau.dataTypeEnum.string,
				description:'Value units.',
				id:'item_units',
			},
			username:{
				alias: 'Username',
				dataType:tableau.dataTypeEnum.string,
				description:'Username for authentication. Used by simple check, SSH, Telnet, database monitor and JMX items. \n\nRequired by SSH and Telnet items.',
				id:'item_username',
			},
			valuemapid:{
				alias: 'Value Map ID',
				dataType:tableau.dataTypeEnum.int,
				description:'ID of the associated value map.',
				id:'item_valuemapid',
			}
		},
		"application": {
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host that the application belongs to. \n\nCannot be updated.",
				"id": "application_hostid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the application",
				"id": "application_name"
			},
			"flags": {
				"alias": "flags",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Origin of the application. \n\nPossible values: \n0 - a plain application; \n4 - a discovered application.",
				"id": "application_flags"
			},
			"templateids": {
				"alias": "templateids",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IDs of the parent template applications.",
				"id": "application_templateids"
			}
		},
		"correlation": {
			"correlationid": {
				"alias": "correlationid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the correlation.",
				"id": "correlation_correlationid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the correlation.",
				"id": "correlation_name"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the correlation.",
				"id": "correlation_description"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the correlation is enabled or disabled. \n\nPossible values are: \n0 - (default) enabled; \n1 - disabled.",
				"id": "correlation_status"
			}
		},
		"operations": {
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of operation. \n\nPossible values: \n0 - close old events; \n1 - close new event.",
				"id": "operations_type"
			}
		},
		"filter": {
			"evaltype": {
				"alias": "evaltype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Filter condition evaluation method. \n\nPossible values: \n0 - and/or; \n1 - and; \n2 - or; \n3 - custom expression.",
				"id": "filter_evaltype"
			},
			"conditions": {
				"alias": "conditions",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Set of conditions to use for filtering results.",
				"id": "filter_conditions"
			},
			"eval_formula": {
				"alias": "eval_formula",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Generated expression that will be used for evaluating conditions. The expression contains IDs that reference specific conditions by its formulaid. The value of eval_formula is equal to the value of formulafor filters with a custom expression.",
				"id": "filter_eval_formula"
			},
			"formula": {
				"alias": "formula",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User-defined expression to be used for evaluating conditions of filters with a custom expression. The expression must contain IDs that reference specific conditions by its formulaid. The IDs used in the expression must exactly match the ones defined in the conditions: no condition can remain unused or omitted.\n\nRequired for custom expression filters.",
				"id": "filter_formula"
			}
		},
		"condition": {
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of condition. \n\nPossible values: \n0 - old event tag; \n1 - new event tag; \n2 - new event host group; \n3 - event tag pair; \n4 - old event tag value; \n5 - new event tag value.",
				"id": "condition_type"
			},
			"tag": {
				"alias": "tag",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Event tag (old or new). Required when type of condition is: 0, 1, 4, 5.",
				"id": "condition_tag"
			},
			"groupid": {
				"alias": "groupid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Host group ID. Required when type of condition is: 2.",
				"id": "condition_groupid"
			},
			"oldtag": {
				"alias": "oldtag",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Old event tag. Required when type of condition is: 3.",
				"id": "condition_oldtag"
			},
			"newtag": {
				"alias": "newtag",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Old event tag. Required when type of condition is: 3.",
				"id": "condition_newtag"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Event tag (old or new) value. Required when type of condition is: 4, 5.",
				"id": "condition_value"
			},
			"formulaid": {
				"alias": "formulaid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Arbitrary unique ID that is used to reference the condition from a custom expression. Can only contain capital-case letters. The ID must be defined by the user when modifying conditions, but will be generated anew when requesting them afterward.",
				"id": "condition_formulaid"
			},
			"operator": {
				"alias": "operator",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Condition operator. \n\nRequired when type of condition is: 2, 4, 5.",
				"id": "condition_operator"
			}
		},
		"dhost": {
			"dhostid": {
				"alias": "dhostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the dhost.",
				"id": "dhost_dhostid"
			},
			"druleid": {
				"alias": "druleid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the discovery rule that detected the host.",
				"id": "dhost_druleid"
			},
			"lastdown": {
				"alias": "lastdown",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the dhost last went down.",
				"id": "dhost_lastdown"
			},
			"lastup": {
				"alias": "lastup",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the dhost last went up.",
				"id": "dhost_lastup"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the dhost is up or down. A host is up if it has at least one active dservice. \n\nPossible values: \n0 - host up; \n1 - host down.",
				"id": "dhost_status"
			}
		},
		"dservice": {
			"dserviceid": {
				"alias": "dserviceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the dservice.",
				"id": "dservice_dserviceid"
			},
			"dcheckid": {
				"alias": "dcheckid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the dcheck used to detect the service.",
				"id": "dservice_dcheckid"
			},
			"dhostid": {
				"alias": "dhostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the dhost running the service.",
				"id": "dservice_dhostid"
			},
			"dns": {
				"alias": "dns",
				"dataType": tableau.dataTypeEnum.string,
				"description": "DNS of the host running the service.",
				"id": "dservice_dns"
			},
			"ip": {
				"alias": "ip",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IP address of the host running the service.",
				"id": "dservice_ip"
			},
			"key_": {
				"alias": "key_",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Key used by a Zabbix agent dcheck to locate the service.",
				"id": "dservice_key_"
			},
			"lastdown": {
				"alias": "lastdown",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the dservice last went down.",
				"id": "dservice_lastdown"
			},
			"lastup": {
				"alias": "lastup",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the dservice last went up.",
				"id": "dservice_lastup"
			},
			"port": {
				"alias": "port",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Service port number.",
				"id": "dservice_port"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Status of the service. \n\nPossible values: \n0 - service up; \n1 - service down.",
				"id": "dservice_status"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of dservice. The type of service matches the type of the dcheck used to detect the service. \n\nRefer to the dcheck \"type\" property for a list of supported types.",
				"id": "dservice_type"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value returned by the service when performing a Zabbix agent, SNMPv1, SNMPv2 or SNMPv3 dcheck.",
				"id": "dservice_value"
			}
		},
		"dcheck": {
			"dcheckid": {
				"alias": "dcheckid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the dcheck.",
				"id": "dcheck_dcheckid"
			},
			"druleid": {
				"alias": "druleid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the discovery rule that the check belongs to.",
				"id": "dcheck_druleid"
			},
			"key_": {
				"alias": "key_",
				"dataType": tableau.dataTypeEnum.string,
				"description": "The value of this property differs depending on the type type of the check: \n- key to query for Zabbix agent checks, required; \n- SNMP OID for SNMPv1, SNMPv2 and SNMPv3 checks, required.",
				"id": "dcheck_key_"
			},
			"ports": {
				"alias": "ports",
				"dataType": tableau.dataTypeEnum.string,
				"description": "One or several port ranges to check separated by commas. Used for all checks except for ICMP. \n\nDefault: 0.",
				"id": "dcheck_ports"
			},
			"snmp_community": {
				"alias": "snmp_community",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMP community. \n\nRequired for SNMPv1 and SNMPv2 agent checks.",
				"id": "dcheck_snmp_community"
			},
			"snmpv3_authpassphrase": {
				"alias": "snmpv3_authpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Auth passphrase used for SNMPv3 agent checks with security level set to authNoPriv or authPriv.",
				"id": "dcheck_snmpv3_authpassphrase"
			},
			"snmpv3_authprotocol": {
				"alias": "snmpv3_authprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Authentication protocol used for SNMPv3 agent checks with security level set to authNoPriv or authPriv. \n\nPossible values: \n0 - (default) MD5; \n1 - SHA.",
				"id": "dcheck_snmpv3_authprotocol"
			},
			"snmpv3_contextname": {
				"alias": "snmpv3_contextname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 context name. Used only by SNMPv3 checks.",
				"id": "dcheck_snmpv3_contextname"
			},
			"snmpv3_privpassphrase": {
				"alias": "snmpv3_privpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Priv passphrase used for SNMPv3 agent checks with security level set to authPriv.",
				"id": "dcheck_snmpv3_privpassphrase"
			},
			"snmpv3_privprotocol": {
				"alias": "snmpv3_privprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Privacy protocol used for SNMPv3 agent checks with security level set to authPriv. \n\nPossible values: \n0 - (default) DES; \n1 - AES.",
				"id": "dcheck_snmpv3_privprotocol"
			},
			"snmpv3_securitylevel": {
				"alias": "snmpv3_securitylevel",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Security level used for SNMPv3 agent checks. \n\nPossible values: \n0 - noAuthNoPriv; \n1 - authNoPriv; \n2 - authPriv.",
				"id": "dcheck_snmpv3_securitylevel"
			},
			"snmpv3_securityname": {
				"alias": "snmpv3_securityname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Security name used for SNMPv3 agent checks.",
				"id": "dcheck_snmpv3_securityname"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of check. \n\nPossible values: \n0 - (default) SSH; \n1 - LDAP; \n2 - SMTP; \n3 - FTP; \n4 - HTTP; \n5 - POP; \n6 - NNTP; \n7 - IMAP; \n8 - TCP; \n9 - Zabbix agent; \n10 - SNMPv1 agent; \n11 - SNMPv2 agent; \n12 - ICMP ping; \n13 - SNMPv3 agent; \n14 - HTTPS; \n15 - Telnet.",
				"id": "dcheck_type"
			},
			"uniq": {
				"alias": "uniq",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to use this check as a device uniqueness criteria. Only a single unique check can be configured for a discovery rule. Used for Zabbix agent, SNMPv1, SNMPv2 and SNMPv3 agent checks. \n\nPossible values: \n0 - (default) do not use this check as a uniqueness criteria; \n1 - use this check as a uniqueness criteria.",
				"id": "dcheck_uniq"
			}
		},
		"drule": {
			"druleid": {
				"alias": "druleid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the discovery rule.",
				"id": "drule_druleid"
			},
			"iprange": {
				"alias": "iprange",
				"dataType": tableau.dataTypeEnum.string,
				"description": "One or several IP ranges to check separated by commas. \n\nRefer to the network discovery configurationsection for more information on supported formats of IP ranges.",
				"id": "drule_iprange"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the discovery rule.",
				"id": "drule_name"
			},
			"delay": {
				"alias": "delay",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Execution interval of the discovery rule in seconds. \n\nDefault: 3600.",
				"id": "drule_delay"
			},
			"nextcheck": {
				"alias": "nextcheck",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the discovery rule will be executed next.",
				"id": "drule_nextcheck"
			},
			"proxy_hostid": {
				"alias": "proxy_hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the proxy used for discovery.",
				"id": "drule_proxy_hostid"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the discovery rule is enabled. \n\nPossible values: \n0 - (default) enabled; \n1 - disabled.",
				"id": "drule_status"
			}
		},
		"event": {
			"eventid": {
				"alias": "eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the event.",
				"id": "event_eventid"
			},
			"source": {
				"alias": "source",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of the event. \n\nPossible values: \n0 - event created by a trigger; \n1 - event created by a discovery rule; \n2 - event created by active agent auto-registration; \n3 - internal event.",
				"id": "event_source"
			},
			"object": {
				"alias": "object",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of object that is related to the event. \n\nPossible values for trigger events: \n0 - trigger. \n\nPossible values for discovery events: \n1 - dhost; \n2 - dservice. \n\nPossible values for auto-registration events: \n3 - auto-registered host. \n\nPossible values for internal events: \n0 - trigger; \n4 - item; \n5 - LLD rule.",
				"id": "event_object"
			},
			"objectid": {
				"alias": "objectid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the related object.",
				"id": "event_objectid"
			},
			"acknowledged": {
				"alias": "acknowledged",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the event has been acknowledged.",
				"id": "event_acknowledged"
			},
			"clock": {
				"alias": "clock",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the event was created.",
				"id": "event_clock"
			},
			"ns": {
				"alias": "ns",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Nanoseconds when the event was created.",
				"id": "event_ns"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.int,
				"description": "State of the related object. \n\nPossible values for trigger events: \n0 - OK; \n1 - problem. \n\nPossible values for discovery events: \n0 - host or service up; \n1 - host or service down; \n2 - host or service discovered; \n3 - host or service lost. \n\nPossible values for internal events: \n0 - “normal” state; \n1 - “unknown” or “not supported” state. \n\nThis parameter is not used for active agent auto-registration events.",
				"id": "event_value"
			},
			"r_eventid": {
				"alias": "r_eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Recovery event ID",
				"id": "event_r_eventid"
			},
			"c_eventid": {
				"alias": "c_eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Problem event ID who generated OK event",
				"id": "event_c_eventid"
			},
			"correlationid": {
				"alias": "correlationid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Correlation ID",
				"id": "event_correlationid"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User ID if the event was manually closed.",
				"id": "event_userid"
			}
		},
		'acknowledges': {
			"acknowledgeid": {
				"alias": "acknowledgeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "acknowledgement's ID",
				"id": "acknowledges_acknowledgeid"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the user that acknowledged the event",
				"id": "acknowledges_userid"
			},
			"eventid": {
				"alias": "eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the acknowledged event",
				"id": "acknowledges_eventid"
			},
			"clock": {
				"alias": "clock",
				"dataType": tableau.dataTypeEnum.int,
				"description":  "time when the event was acknowledged",
				"id": "acknowledges_clock"
			},
			"message": {
				"alias": "message",
				"dataType": tableau.dataTypeEnum.string,
				"description": "text of the acknowledgement message",
				"id": "acknowledges_message"
			},
			"alias": {
				"alias": "alias",
				"dataType": tableau.dataTypeEnum.string,
				"description": "alias of the user that acknowledged the event",
				"id": "acknowledges_alias"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "name of the user that acknowledged the event",
				"id": "acknowledges_name"
			},
			"surname": {
				"alias": "surname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "surname of the user that acknowledged the event",
				"id": "acknowledges_surname"
			}
		},
		"graph": {
			"graphid": {
				"alias": "graphid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the graph.",
				"id": "graph_graphid"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the graph in pixels.",
				"id": "graph_height"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the graph",
				"id": "graph_name"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the graph in pixels.",
				"id": "graph_width"
			},
			"flags": {
				"alias": "flags",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Origin of the graph. \n\nPossible values are: \n0 - (default) a plain graph; \n4 - a discovered graph.",
				"id": "graph_flags"
			},
			"graphtype": {
				"alias": "graphtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Graph's layout type. \n\nPossible values: \n0 - (default) normal; \n1 - stacked; \n2 - pie; \n3 - exploded.",
				"id": "graph_graphtype"
			},
			"percent_left": {
				"alias": "percent_left",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Left percentile. \n\nDefault: 0.",
				"id": "graph_percent_left"
			},
			"percent_right": {
				"alias": "percent_right",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Right percentile. \n\nDefault: 0.",
				"id": "graph_percent_right"
			},
			"show_3d": {
				"alias": "show_3d",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show pie and exploded graphs in 3D. \n\nPossible values: \n0 - (default) show in 2D; \n1 - show in 3D.",
				"id": "graph_show_3d"
			},
			"show_legend": {
				"alias": "show_legend",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show the legend on the graph. \n\nPossible values: \n0 - hide; \n1 - (default) show.",
				"id": "graph_show_legend"
			},
			"show_work_period": {
				"alias": "show_work_period",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show the working time on the graph. \n\nPossible values: \n0 - hide; \n1 - (default) show.",
				"id": "graph_show_work_period"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template graph.",
				"id": "graph_templateid"
			},
			"yaxismax": {
				"alias": "yaxismax",
				"dataType": tableau.dataTypeEnum.float,
				"description": "The fixed maximum value for the Y axis.\n\nDefault: 100.",
				"id": "graph_yaxismax"
			},
			"yaxismin": {
				"alias": "yaxismin",
				"dataType": tableau.dataTypeEnum.float,
				"description": "The fixed minimum value for the Y axis.\n\nDefault: 0.",
				"id": "graph_yaxismin"
			},
			"ymax_itemid": {
				"alias": "ymax_itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item that is used as the maximum value for the Y axis.",
				"id": "graph_ymax_itemid"
			},
			"ymax_type": {
				"alias": "ymax_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Maximum value calculation method for the Y axis. \n\nPossible values: \n0 - (default) calculated; \n1 - fixed; \n2 - item.",
				"id": "graph_ymax_type"
			},
			"ymin_itemid": {
				"alias": "ymin_itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item that is used as the minimum value for the Y axis.",
				"id": "graph_ymin_itemid"
			},
			"ymin_type": {
				"alias": "ymin_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Minimum value calculation method for the Y axis. \n\nPossible values: \n0 - (default) calculated; \n1 - fixed; \n2 - item.",
				"id": "graph_ymin_type"
			}
		},
		"graphitem": {
			"gitemid": {
				"alias": "gitemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the graph item.",
				"id": "graphitem_gitemid"
			},
			"color": {
				"alias": "color",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Graph item's draw color as a hexadecimal color code.",
				"id": "graphitem_color"
			},
			"itemid": {
				"alias": "itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item.",
				"id": "graphitem_itemid"
			},
			"calc_fnc": {
				"alias": "calc_fnc",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Value of the item that will be displayed. \n\nPossible values: \n1 - minimum value; \n2 - (default) average value; \n4 - maximum value; \n7 - all values; \n9 - last value, used only by pie and exploded graphs.",
				"id": "graphitem_calc_fnc"
			},
			"drawtype": {
				"alias": "drawtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Draw style of the graph item. \n\nPossible values: \n0 - (default) line; \n1 - filled region; \n2 - bold line; \n3 - dot; \n4 - dashed line; \n5 - gradient line.",
				"id": "graphitem_drawtype"
			},
			"graphid": {
				"alias": "graphid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the graph that the graph item belongs to.",
				"id": "graphitem_graphid"
			},
			"sortorder": {
				"alias": "sortorder",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Position of the item in the graph. \n\nDefault: starts with 0 and increases by one with each entry.",
				"id": "graphitem_sortorder"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of graph item. \n\nPossible values: \n0 - (default) simple; \n2 - graph sum, used only by pie and exploded graphs.",
				"id": "graphitem_type"
			},
			"yaxisside": {
				"alias": "yaxisside",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Side of the graph where the graph item's Y scale will be drawn. \n\nPossible values: \n0 - (default) left side; \n1 - right side.",
				"id": "graphitem_yaxisside"
			}
		},
		"graphprototype": {
			"graphid": {
				"alias": "graphid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the graph prototype.",
				"id": "graphprototype_graphid"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the graph prototype in pixels.",
				"id": "graphprototype_height"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the graph prototype.",
				"id": "graphprototype_name"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the graph prototype in pixels.",
				"id": "graphprototype_width"
			},
			"graphtype": {
				"alias": "graphtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Graph prototypes's layout type. \n\nPossible values: \n0 - (default) normal; \n1 - stacked; \n2 - pie; \n3 - exploded.",
				"id": "graphprototype_graphtype"
			},
			"percent_left": {
				"alias": "percent_left",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Left percentile. \n\nDefault: 0.",
				"id": "graphprototype_percent_left"
			},
			"percent_right": {
				"alias": "percent_right",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Right percentile. \n\nDefault: 0.",
				"id": "graphprototype_percent_right"
			},
			"show_3d": {
				"alias": "show_3d",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show discovered pie and exploded graphs in 3D. \n\nPossible values: \n0 - (default) show in 2D; \n1 - show in 3D.",
				"id": "graphprototype_show_3d"
			},
			"show_legend": {
				"alias": "show_legend",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show the legend on the discovered graph. \n\nPossible values: \n0 - hide; \n1 - (default) show.",
				"id": "graphprototype_show_legend"
			},
			"show_work_period": {
				"alias": "show_work_period",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show the working time on the discovered graph. \n\nPossible values: \n0 - hide; \n1 - (default) show.",
				"id": "graphprototype_show_work_period"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template graph prototype.",
				"id": "graphprototype_templateid"
			},
			"yaxismax": {
				"alias": "yaxismax",
				"dataType": tableau.dataTypeEnum.float,
				"description": "The fixed maximum value for the Y axis.",
				"id": "graphprototype_yaxismax"
			},
			"yaxismin": {
				"alias": "yaxismin",
				"dataType": tableau.dataTypeEnum.float,
				"description": "The fixed minimum value for the Y axis.",
				"id": "graphprototype_yaxismin"
			},
			"ymax_itemid": {
				"alias": "ymax_itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item that is used as the maximum value for the Y axis.",
				"id": "graphprototype_ymax_itemid"
			},
			"ymax_type": {
				"alias": "ymax_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Maximum value calculation method for the Y axis. \n\nPossible values: \n0 - (default) calculated; \n1 - fixed; \n2 - item.",
				"id": "graphprototype_ymax_type"
			},
			"ymin_itemid": {
				"alias": "ymin_itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item that is used as the minimum value for the Y axis.",
				"id": "graphprototype_ymin_itemid"
			},
			"ymin_type": {
				"alias": "ymin_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Minimum value calculation method for the Y axis. \n\nPossible values: \n0 - (default) calculated; \n1 - fixed; \n2 - item.",
				"id": "graphprototype_ymin_type"
			}
		},
		"history" : {
			"float": {
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "history_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "history_itemid"
				},
				"ns": {
					"alias": "ns",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Nanoseconds when the value was received.",
					"id": "history_ns"
				},
				"value": {
					"alias": "value",
					"dataType": tableau.dataTypeEnum.float,
					"description": "Received value.",
					"id": "history_value"
				}
			},
			"int": {
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "history_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "history_itemid"
				},
				"ns": {
					"alias": "ns",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Nanoseconds when the value was received.",
					"id": "history_ns"
				},
				"value": {
					"alias": "value",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Received value.",
					"id": "history_value"
				}
			},
			"string": {
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "history_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "history_itemid"
				},
				"ns": {
					"alias": "ns",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Nanoseconds when the value was received.",
					"id": "history_ns"
				},
				"value": {
					"alias": "value",
					"dataType": tableau.dataTypeEnum.string,
					"description": "Received value.",
					"id": "history_value"
				}
			},
			"text": {
				"id": {
					"alias": "id",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the history entry.",
					"id": "history_id"
				},
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "history_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "history_itemid"
				},
				"ns": {
					"alias": "ns",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Nanoseconds when the value was received.",
					"id": "history_ns"
				},
				"value": {
					"alias": "value",
					"dataType": tableau.dataTypeEnum.string,
					"description": "Received value.",
					"id": "history_value"
				}
			},
			"log": {
				"id": {
					"alias": "id",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the history entry.",
					"id": "history_id"
				},
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "history_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "history_itemid"
				},
				"logeventid": {
					"alias": "logeventid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Windows event log entry ID.",
					"id": "history_logeventid"
				},
				"ns": {
					"alias": "ns",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Nanoseconds when the value was received.",
					"id": "history_ns"
				},
				"severity": {
					"alias": "severity",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Windows event log entry level.",
					"id": "history_severity"
				},
				"source": {
					"alias": "source",
					"dataType": tableau.dataTypeEnum.string,
					"description": "Windows event log entry source.",
					"id": "history_source"
				},
				"timestamp": {
					"alias": "timestamp",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Windows event log entry time.",
					"id": "history_timestamp"
				},
				"value": {
					"alias": "value",
					"dataType": tableau.dataTypeEnum.string,
					"description": "Received value.",
					"id": "history_value"
				}
			}
		},
		"hostgroup": {
			"groupid": {
				"alias": "groupid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host group.",
				"id": "hostgroup_groupid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the host group.",
				"id": "hostgroup_name"
			},
			"flags": {
				"alias": "flags",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Origin of the host group. \n\nPossible values: \n0 - a plain host group; \n4 - a dhost group.",
				"id": "hostgroup_flags"
			},
			"internal": {
				"alias": "internal",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the group is used internally by the system. An internal group cannot be deleted. \n\nPossible values: \n0 - (default) not internal; \n1 - internal.",
				"id": "hostgroup_internal"
			}
		},
		"hostinterface": {
			"interfaceid": {
				"alias": "interfaceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the interface.",
				"id": "hostinterface_interfaceid"
			},
			"dns": {
				"alias": "dns",
				"dataType": tableau.dataTypeEnum.string,
				"description": "DNS name used by the interface. \n\nCan be empty if the connection is made via IP.",
				"id": "hostinterface_dns"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host the interface belongs to.",
				"id": "hostinterface_hostid"
			},
			"ip": {
				"alias": "ip",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IP address used by the interface. \n\nCan be empty if the connection is made via DNS.",
				"id": "hostinterface_ip"
			},
			"main": {
				"alias": "main",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the interface is used as default on the host. Only one interface of some type can be set as default on a host. \n\nPossible values are: \n0 - not default; \n1 - default.",
				"id": "hostinterface_main"
			},
			"port": {
				"alias": "port",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Port number used by the interface. Can contain user macros.",
				"id": "hostinterface_port"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Interface type. \n\nPossible values are: \n1 - agent; \n2 - SNMP; \n3 - IPMI; \n4 - JMX. ",
				"id": "hostinterface_type"
			},
			"useip": {
				"alias": "useip",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the connection should be made via IP. \n\nPossible values are: \n0 - connect using host DNS name; \n1 - connect using host IP address for this host interface.",
				"id": "hostinterface_useip"
			},
			"bulk": {
				"alias": "bulk",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to use bulk SNMP requests. \n\nPossible values are: \n0 - don't use bulk requests; \n1 - (default) use bulk requests.",
				"id": "hostinterface_bulk"
			}
		},
		"hostprototype": {
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host prototype.",
				"id": "hostprototype_hostid"
			},
			"host": {
				"alias": "host",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Technical name of the host prototype.",
				"id": "hostprototype_host"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Visible name of the host prototype. \n\nDefault: host property value.",
				"id": "hostprototype_name"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Status of the host prototype. \n\nPossible values are:\n0 - (default) monitored host;\n1 - unmonitored host.",
				"id": "hostprototype_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template host prototype.",
				"id": "hostprototype_templateid"
			},
			"tls_connect": {
				"alias": "tls_connect",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Connections to host. \n\nPossible values are: \n1 - (default) No encryption; \n2 - PSK; \n4 - certificate.",
				"id": "hostprototype_tls_connect"
			},
			"tls_accept": {
				"alias": "tls_accept",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Connections from host. \n\nPossible bitmap values are: \n1 - (default) No encryption; \n2 - PSK; \n4 - certificate.",
				"id": "hostprototype_tls_accept"
			},
			"tls_issuer": {
				"alias": "tls_issuer",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Certificate issuer.",
				"id": "hostprototype_tls_issuer"
			},
			"tls_subject": {
				"alias": "tls_subject",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Certificate subject.",
				"id": "hostprototype_tls_subject"
			},
			"tls_psk_identity": {
				"alias": "tls_psk_identity",
				"dataType": tableau.dataTypeEnum.string,
				"description": "PSK identity. Required if either tls_connector tls_accept has PSK enabled.",
				"id": "hostprototype_tls_psk_identity"
			},
			"tls_psk": {
				"alias": "tls_psk",
				"dataType": tableau.dataTypeEnum.string,
				"description": "The preshared key, at least 32 hex digits. Required if either tls_connect or tls_accept has PSK enabled.",
				"id": "hostprototype_tls_psk"
			}
		},
		"hostprototype inventory": {
			"inventory_mode": {
				"alias": "inventory_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Host prototype inventory population mode. \n\nPossible values are: \n-1 - disabled; \n0 - (default) manual; \n1 - automatic.",
				"id": "hostprototype inventory_inventory_mode"
			}
		},
		"group link": {
			"group_prototypeid": {
				"alias": "group_prototypeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the group link.",
				"id": "group link_group_prototypeid"
			},
			"groupid": {
				"alias": "groupid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host group.",
				"id": "group link_groupid"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host prototype",
				"id": "group link_hostid"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template group link.",
				"id": "group link_templateid"
			}
		},
		"group prototype": {
			"group_prototypeid": {
				"alias": "group_prototypeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the group prototype.",
				"id": "group prototype_group_prototypeid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the group prototype.",
				"id": "group prototype_name"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host prototype",
				"id": "group prototype_hostid"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template group prototype.",
				"id": "group prototype_templateid"
			}
		},
		"iconmap": {
			"iconmapid": {
				"alias": "iconmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the icon map.",
				"id": "iconmap_iconmapid"
			},
			"default_iconid": {
				"alias": "default_iconid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the default icon.",
				"id": "iconmap_default_iconid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the icon map.",
				"id": "iconmap_name"
			}
		},
		"iconmapping": {
			"iconmappingid": {
				"alias": "iconmappingid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the icon map.",
				"id": "iconmapping_iconmappingid"
			},
			"iconid": {
				"alias": "iconid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the icon used by the icon mapping.",
				"id": "iconmapping_iconid"
			},
			"expression": {
				"alias": "expression",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Expression to match the inventory field against.",
				"id": "iconmapping_expression"
			},
			"inventory_link": {
				"alias": "inventory_link",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host inventory field. \n\nRefer to the host inventory object for a list of supported inventory fields.",
				"id": "iconmapping_inventory_link"
			},
			"iconmapid": {
				"alias": "iconmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the icon map that the icon mapping belongs to.",
				"id": "iconmapping_iconmapid"
			},
			"sortorder": {
				"alias": "sortorder",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Position of the icon mapping in the icon map. \n\nDefault: starts with 0 and increases by one with each entry.",
				"id": "iconmapping_sortorder"
			}
		},
		"image": {
			"imageid": {
				"alias": "imageid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the image.",
				"id": "image_imageid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the image.",
				"id": "image_name"
			},
			"imagetype": {
				"alias": "imagetype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of image. \n\nPossible values: \n1 - (default) icon; \n2 - background image.",
				"id": "image_imagetype"
			}
		},
		"itemprototype": {
			"itemid": {
				"alias": "itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item prototype.",
				"id": "itemprototype_itemid"
			},
			"delay": {
				"alias": "delay",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Update interval of the item prototype in seconds.",
				"id": "itemprototype_delay"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host that the item prototype belongs to.",
				"id": "itemprototype_hostid"
			},
			"interfaceid": {
				"alias": "interfaceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the item prototype's host interface. Used only for host item prototypes. \n\nOptional for Zabbix agent (active), Zabbix internal, Zabbix trapper, Zabbix aggregate, database monitor and calculated item prototypes.",
				"id": "itemprototype_interfaceid"
			},
			"key_": {
				"alias": "key_",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Item prototype key.",
				"id": "itemprototype_key_"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the item prototype.",
				"id": "itemprototype_name"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of the item prototype. \n\nPossible values: \n0 - Zabbix agent; \n1 - SNMPv1 agent; \n2 - Zabbix trapper; \n3 - simple check; \n4 - SNMPv2 agent; \n5 - Zabbix internal; \n6 - SNMPv3 agent; \n7 - Zabbix agent (active); \n8 - Zabbix aggregate; \n10 - external check; \n11 - database monitor; \n12 - IPMI agent; \n13 - SSH agent; \n14 - TELNET agent; \n15 - calculated; \n16 - JMX agent; \n17 - SNMP trap.",
				"id": "itemprototype_type"
			},
			"value_type": {
				"alias": "value_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of information of the item prototype. \n\nPossible values: \n0 - numeric float; \n1 - character; \n2 - log; \n3 - numeric unsigned; \n4 - text.",
				"id": "itemprototype_value_type"
			},
			"authtype": {
				"alias": "authtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SSH authentication method. Used only by SSH agent item prototypes. \n\nPossible values: \n0 - (default) password; \n1 - public key.",
				"id": "itemprototype_authtype"
			},
			"data_type": {
				"alias": "data_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Data type of the item prototype. \n\nPossible values: \n0 - (default) decimal; \n1 - octal; \n2 - hexadecimal; \n3 - boolean.",
				"id": "itemprototype_data_type"
			},
			"delay_flex": {
				"alias": "delay_flex",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom intervals that contain flexible intervals and scheduling intervals as serialized strings. \n\nMultiple intervals are separated by a semicolon.",
				"id": "itemprototype_delay_flex"
			},
			"delta": {
				"alias": "delta",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Value that will be stored. \n\nPossible values: \n0 - (default) as is; \n1 - Delta, speed per second; \n2 - Delta, simple change.",
				"id": "itemprototype_delta"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the item prototype.",
				"id": "itemprototype_description"
			},
			"formula": {
				"alias": "formula",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Custom multiplier. \n\nDefault: 1.",
				"id": "itemprototype_formula"
			},
			"history": {
				"alias": "history",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of days to keep item prototype's history data. \n\nDefault: 90.",
				"id": "itemprototype_history"
			},
			"ipmi_sensor": {
				"alias": "ipmi_sensor",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IPMI sensor. Used only by IPMI item prototypes.",
				"id": "itemprototype_ipmi_sensor"
			},
			"logtimefmt": {
				"alias": "logtimefmt",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Format of the time in log entries. Used only by log item prototypes.",
				"id": "itemprototype_logtimefmt"
			},
			"multiplier": {
				"alias": "multiplier",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to use a custom multiplier.",
				"id": "itemprototype_multiplier"
			},
			"params": {
				"alias": "params",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Additional parameters depending on the type of the item prototype: \n- executed script for SSH and Telnet item prototypes; \n- SQL query for database monitor item prototypes; \n- formula for calculated item prototypes.",
				"id": "itemprototype_params"
			},
			"password": {
				"alias": "password",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Password for authentication. Used by simple check, SSH, Telnet, database monitor and JMX item prototypes.",
				"id": "itemprototype_password"
			},
			"port": {
				"alias": "port",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Port monitored by the item prototype. Used only by SNMP items prototype.",
				"id": "itemprototype_port"
			},
			"privatekey": {
				"alias": "privatekey",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the private key file.",
				"id": "itemprototype_privatekey"
			},
			"publickey": {
				"alias": "publickey",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the public key file.",
				"id": "itemprototype_publickey"
			},
			"snmp_community": {
				"alias": "snmp_community",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMP community. \n\nUsed only by SNMPv1 and SNMPv2 item prototypes.",
				"id": "itemprototype_snmp_community"
			},
			"snmp_oid": {
				"alias": "snmp_oid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMP OID.",
				"id": "itemprototype_snmp_oid"
			},
			"snmpv3_authpassphrase": {
				"alias": "snmpv3_authpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 auth passphrase. Used only by SNMPv3 item prototypes.",
				"id": "itemprototype_snmpv3_authpassphrase"
			},
			"snmpv3_authprotocol": {
				"alias": "snmpv3_authprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 authentication protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) MD5; \n1 - SHA.",
				"id": "itemprototype_snmpv3_authprotocol"
			},
			"snmpv3_contextname": {
				"alias": "snmpv3_contextname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 context name. Used only by SNMPv3 item prototypes.",
				"id": "itemprototype_snmpv3_contextname"
			},
			"snmpv3_privpassphrase": {
				"alias": "snmpv3_privpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 priv passphrase. Used only by SNMPv3 item prototypes.",
				"id": "itemprototype_snmpv3_privpassphrase"
			},
			"snmpv3_privprotocol": {
				"alias": "snmpv3_privprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 privacy protocol. Used only by SNMPv3 items. \n\nPossible values: \n0 - (default) DES; \n1 - AES.",
				"id": "itemprototype_snmpv3_privprotocol"
			},
			"snmpv3_securitylevel": {
				"alias": "snmpv3_securitylevel",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 security level. Used only by SNMPv3 item prototypes. \n\nPossible values: \n0 - noAuthNoPriv; \n1 - authNoPriv; \n2 - authPriv.",
				"id": "itemprototype_snmpv3_securitylevel"
			},
			"snmpv3_securityname": {
				"alias": "snmpv3_securityname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 security name. Used only by SNMPv3 item prototypes.",
				"id": "itemprototype_snmpv3_securityname"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Status of the item prototype. \n\nPossible values: \n0 - (default) enabled item prototype; \n1 - disabled item prototype; \n3 - unsupported item prototype.",
				"id": "itemprototype_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "(readonly) ID of the parent template item prototype.",
				"id": "itemprototype_templateid"
			},
			"trapper_hosts": {
				"alias": "trapper_hosts",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Allowed hosts. Used only by trapper item prototypes.",
				"id": "itemprototype_trapper_hosts"
			},
			"trends": {
				"alias": "trends",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of days to keep item prototype's trends data. \n\nDefault: 365.",
				"id": "itemprototype_trends"
			},
			"units": {
				"alias": "units",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value units.",
				"id": "itemprototype_units"
			},
			"username": {
				"alias": "username",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Username for authentication. Used by simple check, SSH, Telnet, database monitor and JMX item prototypes. \n\nRequired by SSH and Telnet item prototypes.",
				"id": "itemprototype_username"
			},
			"valuemapid": {
				"alias": "valuemapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the associated value map.",
				"id": "itemprototype_valuemapid"
			}
		},
		"service": {
			"serviceid": {
				"alias": "serviceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the IT service.",
				"id": "service_serviceid"
			},
			"algorithm": {
				"alias": "algorithm",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Algorithm used to calculate the state of the IT service. \n\nPossible values: \n0 - do not calculate; \n1 - problem, if at least one child has a problem; \n2 - problem, if all children have problems.",
				"id": "service_algorithm"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the IT service.",
				"id": "service_name"
			},
			"showsla": {
				"alias": "showsla",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether SLA should be calculated. \n\nPossible values: \n0 - do not calculate; \n1 - calculate.",
				"id": "service_showsla"
			},
			"sortorder": {
				"alias": "sortorder",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Position of the IT service used for sorting.",
				"id": "service_sortorder"
			},
			"goodsla": {
				"alias": "goodsla",
				"dataType": tableau.dataTypeEnum.float,
				"description": "Minimum acceptable SLA value. If the SLA drops lower, the IT service is considered to be in problem state. \n\nDefault: 99.9.",
				"id": "service_goodsla"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the IT service is in OK or problem state. \n\nIf the IT service is in problem state, status is equal either to: \n- the priority of the linked trigger if it is set to 2, “Warning” or higher (priorities 0, “Not classified” and 1, “Information” are ignored); \n- the highest status of a child IT service in problem state. \n\nIf the IT service is in OK state, status is equal to 0.",
				"id": "service_status"
			},
			"triggerid": {
				"alias": "triggerid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Trigger associated with the IT service. Can only be set for IT services that don't have children. \n\nDefault: 0",
				"id": "service_triggerid"
			}
		},
		"service time": {
			"timeid": {
				"alias": "timeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the service time.",
				"id": "service time_timeid"
			},
			"serviceid": {
				"alias": "serviceid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the IT service. \n\nCannot be updated.",
				"id": "service time_serviceid"
			},
			"ts_from": {
				"alias": "ts_from",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the service time comes into effect. \n\nFor onetime downtimes ts_from must be set as a Unix timestamp, for other types - as a specific time in a week, in seconds, for example, 90000 for Tue, 2:00 AM.",
				"id": "service time_ts_from"
			},
			"ts_to": {
				"alias": "ts_to",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the service time ends. \n\nFor onetime uptimes ts_to must be set as a Unix timestamp, for other types - as a specific time in a week, in seconds, for example, 90000 for Tue, 2:00 AM.",
				"id": "service time_ts_to"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Service time type. \n\nPossible values: \n0 - planned uptime, repeated every week; \n1 - planned downtime, repeated every week; \n2 - one-time downtime.",
				"id": "service time_type"
			},
			"note": {
				"alias": "note",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Additional information about the service time.",
				"id": "service time_note"
			}
		},
		"service dependency": {
			"linkid": {
				"alias": "linkid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the service dependency.",
				"id": "service dependency_linkid"
			},
			"servicedownid\n(required)": {
				"alias": "servicedownid\n(required)",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the IT service, that a service depends on, that is, the child service. An IT service can have multiple children.",
				"id": "service dependency_servicedownid\n(required)"
			},
			"serviceupid": {
				"alias": "serviceupid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the IT service, that is dependent on a service, that is, the parent service. An IT service can have multiple parents forming a directed graph.",
				"id": "service dependency_serviceupid"
			},
			"soft": {
				"alias": "soft",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of dependency between IT services. \n\nPossible values: \n0 - hard dependency; \n1 - soft dependency. \n\nAn IT service can have only one hard-dependent parent. This attribute has no effect on status or SLA calculation and is only used to create a core IT service tree. Additional parents can be added as soft dependencies forming a graph. \n\nAn IT service can not be deleted if it has hard-dependent children.",
				"id": "service dependency_soft"
			}
		},
		"service alarm": {
			"servicealarmid": {
				"alias": "servicealarmid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the service alarm.",
				"id": "service alarm_servicealarmid"
			},
			"serviceid": {
				"alias": "serviceid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the IT service.",
				"id": "service alarm_serviceid"
			},
			"clock": {
				"alias": "clock",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the IT service state change has happened.",
				"id": "service alarm_clock"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Status of the IT service. \n\nRefer the the IT service status property for a list of possible values.",
				"id": "service alarm_value"
			}
		},
		"discoveryrule": {
			"itemid": {
				"alias": "itemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the LLD rule.",
				"id": "discoveryrule_itemid"
			},
			"delay": {
				"alias": "delay",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Update interval of the LLD rule in seconds.",
				"id": "discoveryrule_delay"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host that the LLD rule belongs to.",
				"id": "discoveryrule_hostid"
			},
			"interfaceid": {
				"alias": "interfaceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the LLD rule's host interface. Used only for host LLD rules. \n\nOptional for Zabbix agent (active), Zabbix internal, Zabbix trapper and database monitor LLD rules.",
				"id": "discoveryrule_interfaceid"
			},
			"key_": {
				"alias": "key_",
				"dataType": tableau.dataTypeEnum.string,
				"description": "LLD rule key.",
				"id": "discoveryrule_key_"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the LLD rule.",
				"id": "discoveryrule_name"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of the LLD rule. \n\nPossible values: \n0 - Zabbix agent; \n1 - SNMPv1 agent; \n2 - Zabbix trapper; \n3 - simple check; \n4 - SNMPv2 agent; \n5 - Zabbix internal; \n6 - SNMPv3 agent; \n7 - Zabbix agent (active); \n10 - external check; \n11 - database monitor; \n12 - IPMI agent; \n13 - SSH agent; \n14 - TELNET agent; \n16 - JMX agent.",
				"id": "discoveryrule_type"
			},
			"authtype": {
				"alias": "authtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SSH authentication method. Used only by SSH agent LLD rules. \n\nPossible values: \n0 - (default) password; \n1 - public key.",
				"id": "discoveryrule_authtype"
			},
			"delay_flex": {
				"alias": "delay_flex",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom intervals that contain flexible intervals and scheduling intervals as serialized strings. \n\nMultiple intervals are separated by a semicolon.",
				"id": "discoveryrule_delay_flex"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the LLD rule.",
				"id": "discoveryrule_description"
			},
			"error": {
				"alias": "error",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Error text if there are problems updating the LLD rule.",
				"id": "discoveryrule_error"
			},
			"ipmi_sensor": {
				"alias": "ipmi_sensor",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IPMI sensor. Used only by IPMI LLD rules.",
				"id": "discoveryrule_ipmi_sensor"
			},
			"lifetime": {
				"alias": "lifetime",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time period after which items that are no longer discovered will be deleted, in days. \n\nDefault: 30.",
				"id": "discoveryrule_lifetime"
			},
			"params": {
				"alias": "params",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Additional parameters depending on the type of the LLD rule: \n- executed script for SSH and Telnet LLD rules; \n- SQL query for database monitor LLD rules; \n- formula for calculated LLD rules.",
				"id": "discoveryrule_params"
			},
			"password": {
				"alias": "password",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Password for authentication. Used by simple check, SSH, Telnet, database monitor and JMX LLD rules.",
				"id": "discoveryrule_password"
			},
			"port": {
				"alias": "port",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Port used by the LLD rule. Used only by SNMP LLD rules.",
				"id": "discoveryrule_port"
			},
			"privatekey": {
				"alias": "privatekey",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the private key file.",
				"id": "discoveryrule_privatekey"
			},
			"publickey": {
				"alias": "publickey",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the public key file.",
				"id": "discoveryrule_publickey"
			},
			"snmp_community": {
				"alias": "snmp_community",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMP community. \n\nRequired for SNMPv1 and SNMPv2 LLD rules.",
				"id": "discoveryrule_snmp_community"
			},
			"snmp_oid": {
				"alias": "snmp_oid",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMP OID.",
				"id": "discoveryrule_snmp_oid"
			},
			"snmpv3_authpassphrase": {
				"alias": "snmpv3_authpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 auth passphrase. Used only by SNMPv3 LLD rules.",
				"id": "discoveryrule_snmpv3_authpassphrase"
			},
			"snmpv3_authprotocol": {
				"alias": "snmpv3_authprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 authentication protocol. Used only by SNMPv3 LLD rules. \n\nPossible values: \n0 - (default) MD5; \n1 - SHA.",
				"id": "discoveryrule_snmpv3_authprotocol"
			},
			"snmpv3_contextname": {
				"alias": "snmpv3_contextname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 context name. Used only by SNMPv3 checks.",
				"id": "discoveryrule_snmpv3_contextname"
			},
			"snmpv3_privpassphrase": {
				"alias": "snmpv3_privpassphrase",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 priv passphrase. Used only by SNMPv3 LLD rules.",
				"id": "discoveryrule_snmpv3_privpassphrase"
			},
			"snmpv3_privprotocol": {
				"alias": "snmpv3_privprotocol",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 privacy protocol. Used only by SNMPv3 LLD rules. \n\nPossible values: \n0 - (default) DES; \n1 - AES.",
				"id": "discoveryrule_snmpv3_privprotocol"
			},
			"snmpv3_securitylevel": {
				"alias": "snmpv3_securitylevel",
				"dataType": tableau.dataTypeEnum.int,
				"description": "SNMPv3 security level. Used only by SNMPv3 LLD rules. \n\nPossible values: \n0 - noAuthNoPriv; \n1 - authNoPriv; \n2 - authPriv.",
				"id": "discoveryrule_snmpv3_securitylevel"
			},
			"snmpv3_securityname": {
				"alias": "snmpv3_securityname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SNMPv3 security name. Used only by SNMPv3 LLD rules.",
				"id": "discoveryrule_snmpv3_securityname"
			},
			"state": {
				"alias": "state",
				"dataType": tableau.dataTypeEnum.int,
				"description": "State of the LLD rule. \n\nPossible values: \n0 - (default) normal; \n1 - not supported.",
				"id": "discoveryrule_state"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Status of the LLD rule. \n\nPossible values: \n0 - (default) enabled LLD rule; \n1 - disabled LLD rule.",
				"id": "discoveryrule_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "(readonly) ID of the parent template LLD rule.",
				"id": "discoveryrule_templateid"
			},
			"trapper_hosts": {
				"alias": "trapper_hosts",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Allowed hosts. Used only by trapper LLD rules.",
				"id": "discoveryrule_trapper_hosts"
			},
			"username": {
				"alias": "username",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Username for authentication. Used by simple check, SSH, Telnet, database monitor and JMX LLD rules. \n\nRequired by SSH and Telnet LLD rules.",
				"id": "discoveryrule_username"
			}
		},
		"discoveryrule filter": {
			"conditions": {
				"alias": "conditions",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Set of conditions to use for filtering results.",
				"id": "discoveryrule filter_conditions"
			},
			"evaltype": {
				"alias": "evaltype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Filter condition evaluation method. \n\nPossible values: \n0 - and/or; \n1 - and; \n2 - or; \n3 - custom expression.",
				"id": "discoveryrule filter_evaltype"
			},
			"eval_formula": {
				"alias": "eval_formula",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Generated expression that will be used for evaluating conditions. The expression contains IDs that reference specific conditions by its formulaid. The value of eval_formula is equal to the value of formulafor filters with a custom expression.",
				"id": "discoveryrule filter_eval_formula"
			},
			"formula": {
				"alias": "formula",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User-defined expression to be used for evaluating conditions of filters with a custom expression. The expression must contain IDs that reference specific conditions by its formulaid. The IDs used in the expression must exactly match the ones defined in the conditions: no condition can remain unused or omitted.\n\nRequired for custom expression filters.",
				"id": "discoveryrule filter_formula"
			}
		},
		"discoveryrule condition": {
			"macro": {
				"alias": "macro",
				"dataType": tableau.dataTypeEnum.string,
				"description": "LLD macro to perform the check on.",
				"id": "discoveryrule condition_macro"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value to compare with.",
				"id": "discoveryrule condition_value"
			},
			"formulaid": {
				"alias": "formulaid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Arbitrary unique ID that is used to reference the condition from a custom expression. Can only contain capital-case letters. The ID must be defined by the user when modifying conditions, but will be generated anew when requesting them afterward.",
				"id": "discoveryrule condition_formulaid"
			},
			"operator": {
				"alias": "operator",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Condition operator. \n\nPossible values: \n8 - (default) matches regular expression.",
				"id": "discoveryrule condition_operator"
			}
		},
		"maintenance": {
			"maintenanceid": {
				"alias": "maintenanceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the maintenance.",
				"id": "maintenance_maintenanceid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the maintenance.",
				"id": "maintenance_name"
			},
			"active_since": {
				"alias": "active_since",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the maintenance becomes active. \n\nDefault: current time.",
				"id": "maintenance_active_since"
			},
			"active_till": {
				"alias": "active_till",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the maintenance stops being active. \n\nDefault: the next day.",
				"id": "maintenance_active_till"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the maintenance.",
				"id": "maintenance_description"
			},
			"maintenance_type": {
				"alias": "maintenance_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of maintenance. \n\nPossible values: \n0 - (default) with data collection; \n1 - without data collection.",
				"id": "maintenance_maintenance_type"
			}
		},
		"time period": {
			"timeperiodid": {
				"alias": "timeperiodid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the maintenance.",
				"id": "time period_timeperiodid"
			},
			"day": {
				"alias": "day",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Day of the month when the maintenance must come into effect. \n\nRequired only for monthly time periods.",
				"id": "time period_day"
			},
			"dayofweek": {
				"alias": "dayofweek",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Days of the week when the maintenance must come into effect. \n\nDays are stored in binary form with each bit representing the corresponding day. For example, 4 equals 100 in binary and means, that maintenance will be enabled on Wednesday. \n\nUsed for weekly and monthly time periods. Required only for weekly time periods.",
				"id": "time period_dayofweek"
			},
			"every": {
				"alias": "every",
				"dataType": tableau.dataTypeEnum.int,
				"description": "For daily and weekly periods everydefines day or week intervals at which the maintenance must come into effect. \n\nFor monthly periods every defines the week of the month when the maintenance must come into effect. \nPossible values: \n1 - first week; \n2 - second week; \n3 - third week; \n4 - fourth week; \n5 - last week.",
				"id": "time period_every"
			},
			"month": {
				"alias": "month",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Months when the maintenance must come into effect. \n\nMonths are stored in binary form with each bit representing the corresponding month. For example, 5 equals 101 in binary and means, that maintenance will be enabled in January and March. \n\nRequired only for monthly time periods.",
				"id": "time period_month"
			},
			"period": {
				"alias": "period",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Duration of the maintenance period in seconds. \n\nDefault: 3600.",
				"id": "time period_period"
			},
			"start_date": {
				"alias": "start_date",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Date when the maintenance period must come into effect. \n\nRequired only for one time periods. \n\nDefault: current date.",
				"id": "time period_start_date"
			},
			"start_time": {
				"alias": "start_time",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time of day when the maintenance starts in seconds. \n\nRequired for daily, weekly and monthly periods.",
				"id": "time period_start_time"
			},
			"timeperiod_type": {
				"alias": "timeperiod_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of time period. \n\nPossible values: \n0 - (default) one time only; \n2 - daily; \n3 - weekly; \n4 - monthly.",
				"id": "time period_timeperiod_type"
			}
		},
		"map": {
			"sysmapid": {
				"alias": "sysmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map.",
				"id": "map_sysmapid"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the map in pixels.",
				"id": "map_height"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the map.",
				"id": "map_name"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the map in pixels.",
				"id": "map_width"
			},
			"backgroundid": {
				"alias": "backgroundid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the image used as the background for the map.",
				"id": "map_backgroundid"
			},
			"expand_macros": {
				"alias": "expand_macros",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to expand macros in labels when configuring the map. \n\nPossible values: \n0 - (default) do not expand macros; \n1 - expand macros.",
				"id": "map_expand_macros"
			},
			"expandproblem": {
				"alias": "expandproblem",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the the problem trigger will be displayed for elements with a single problem. \n\nPossible values: \n0 - always display the number of problems; \n1 - (default) display the problem trigger if there's only one problem.",
				"id": "map_expandproblem"
			},
			"grid_align": {
				"alias": "grid_align",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to enable grid aligning. \n\nPossible values: \n0 - disable grid aligning; \n1 - (default) enable grid aligning.",
				"id": "map_grid_align"
			},
			"grid_show": {
				"alias": "grid_show",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to show the grid on the map. \n\nPossible values: \n0 - do not show the grid; \n1 - (default) show the grid.",
				"id": "map_grid_show"
			},
			"grid_size": {
				"alias": "grid_size",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Size of the map grid in pixels. \n\nSupported values: 20, 40, 50, 75 and 100. \n\nDefault: 50.",
				"id": "map_grid_size"
			},
			"highlight": {
				"alias": "highlight",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether icon highlighting is enabled. \n\nPossible values: \n0 - highlighting disabled; \n1 - (default) highlighting enabled.",
				"id": "map_highlight"
			},
			"iconmapid": {
				"alias": "iconmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the icon map used on the map.",
				"id": "map_iconmapid"
			},
			"label_format": {
				"alias": "label_format",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to enable advanced labels. \n\nPossible values: \n0 - (default) disable advanced labels; \n1 - enable advanced labels.",
				"id": "map_label_format"
			},
			"label_location": {
				"alias": "label_location",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Location of the map element label. \n\nPossible values: \n0 - (default) bottom; \n1 - left; \n2 - right; \n3 - top.",
				"id": "map_label_location"
			},
			"label_string_host": {
				"alias": "label_string_host",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom label for host elements. \n\nRequired for maps with custom host label type.",
				"id": "map_label_string_host"
			},
			"label_string_hostgroup": {
				"alias": "label_string_hostgroup",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom label for host group elements. \n\nRequired for maps with custom host group label type.",
				"id": "map_label_string_hostgroup"
			},
			"label_string_image": {
				"alias": "label_string_image",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom label for image elements. \n\nRequired for maps with custom image label type.",
				"id": "map_label_string_image"
			},
			"label_string_map": {
				"alias": "label_string_map",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom label for map elements. \n\nRequired for maps with custom map label type.",
				"id": "map_label_string_map"
			},
			"label_string_trigger": {
				"alias": "label_string_trigger",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Custom label for trigger elements. \n\nRequired for maps with custom trigger label type.",
				"id": "map_label_string_trigger"
			},
			"label_type": {
				"alias": "label_type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Map element label type. \n\nPossible values: \n0 - label; \n1 - IP address; \n2 - (default) element name; \n3 - status only; \n4 - nothing.",
				"id": "map_label_type"
			},
			"label_type_host": {
				"alias": "label_type_host",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Label type for host elements. \n\nPossible values: \n0 - label; \n1 - IP address; \n2 - (default) element name; \n3 - status only; \n4 - nothing; \n5 - custom.",
				"id": "map_label_type_host"
			},
			"label_type_hostgroup": {
				"alias": "label_type_hostgroup",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Label type for host group elements. \n\nPossible values: \n0 - label; \n2 - (default) element name; \n3 - status only; \n4 - nothing; \n5 - custom.",
				"id": "map_label_type_hostgroup"
			},
			"label_type_image": {
				"alias": "label_type_image",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Label type for host group elements. \n\nPossible values: \n0 - label; \n2 - (default) element name; \n4 - nothing; \n5 - custom.",
				"id": "map_label_type_image"
			},
			"label_type_map": {
				"alias": "label_type_map",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Label type for map elements. \n\nPossible values: \n0 - label; \n2 - (default) element name; \n3 - status only; \n4 - nothing; \n5 - custom.",
				"id": "map_label_type_map"
			},
			"label_type_trigger": {
				"alias": "label_type_trigger",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Label type for trigger elements. \n\nPossible values: \n0 - label; \n2 - (default) element name; \n3 - status only; \n4 - nothing; \n5 - custom.",
				"id": "map_label_type_trigger"
			},
			"markelements": {
				"alias": "markelements",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to highlight map elements that have recently changed their status. \n\nPossible values: \n0 - (default) do not highlight elements; \n1 - highlight elements.",
				"id": "map_markelements"
			},
			"severity_min": {
				"alias": "severity_min",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Minimum severity of the triggers that will be displayed on the map. \n\nRefer to the trigger \"severity\" propertyfor a list of supported trigger severities.",
				"id": "map_severity_min"
			},
			"show_unack": {
				"alias": "show_unack",
				"dataType": tableau.dataTypeEnum.int,
				"description": "How problems should be displayed. \n\nPossible values: \n0 - (default) display the count of all problems; \n1 - display only the count of unacknowledged problems; \n2 - display the count of acknowledged and unacknowledged problems separately.",
				"id": "map_show_unack"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Map owner user ID.",
				"id": "map_userid"
			},
			"private": {
				"alias": "private",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of map sharing. \n\nPossible values: \n0 - public map; \n1 - (default) private map.",
				"id": "map_private"
			}
		},
		"map element": {
			"selementid": {
				"alias": "selementid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map element.",
				"id": "map element_selementid"
			},
			"elementid": {
				"alias": "elementid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the object that the map element represents. \n\nRequired for host, host group, trigger and map type elements.",
				"id": "map element_elementid"
			},
			"elementtype": {
				"alias": "elementtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of map element. \n\nPossible values: \n0 - host; \n1 - map; \n2 - trigger; \n3 - host group; \n4 - image.",
				"id": "map element_elementtype"
			},
			"iconid_off": {
				"alias": "iconid_off",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the image used to display the element in default state.",
				"id": "map element_iconid_off"
			},
			"areatype": {
				"alias": "areatype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "How separate host group hosts should be displayed. \n\nPossible values: \n0 - (default) the host group element will take up the whole map; \n1 - the host group element will have a fixed size.",
				"id": "map element_areatype"
			},
			"application": {
				"alias": "application",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the application to display problems from. Used only for host and host group map elements.",
				"id": "map element_application"
			},
			"elementsubtype": {
				"alias": "elementsubtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "How a host group element should be displayed on a map. \n\nPossible values: \n0 - (default) display the host group as a single element; \n1 - display each host in the group separately.",
				"id": "map element_elementsubtype"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the fixed size host group element in pixels. \n\nDefault: 200.",
				"id": "map element_height"
			},
			"iconid_disabled": {
				"alias": "iconid_disabled",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the image used to display disabled map elements. Unused for image elements.",
				"id": "map element_iconid_disabled"
			},
			"iconid_maintenance": {
				"alias": "iconid_maintenance",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the image used to display map elements in maintenance. Unused for image elements.",
				"id": "map element_iconid_maintenance"
			},
			"iconid_on": {
				"alias": "iconid_on",
				"dataType": tableau.dataTypeEnum.string,
				"description": "ID of the image used to display map elements with problems. Unused for image elements.",
				"id": "map element_iconid_on"
			},
			"label": {
				"alias": "label",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Label of the element.",
				"id": "map element_label"
			},
			"label_location": {
				"alias": "label_location",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Location of the map element label. \n\nPossible values: \n-1 - (default) default location; \n0 - bottom; \n1 - left; \n2 - right; \n3 - top.",
				"id": "map element_label_location"
			},
			"sysmapid": {
				"alias": "sysmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map that the element belongs to.",
				"id": "map element_sysmapid"
			},
			"urls": {
				"alias": "urls",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Map element URLs. \n\nThe map element URL object is described in detail below.",
				"id": "map element_urls"
			},
			"use_iconmap": {
				"alias": "use_iconmap",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether icon mapping must be used for host elements. \n\nPossible values: \n0 - do not use icon mapping; \n1 - (default) use icon mapping.",
				"id": "map element_use_iconmap"
			},
			"viewtype": {
				"alias": "viewtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Host group element placing algorithm. \n\nPossible values: \n0 - (default) grid.",
				"id": "map element_viewtype"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the fixed size host group element in pixels. \n\nDefault: 200.",
				"id": "map element_width"
			},
			"x": {
				"alias": "x",
				"dataType": tableau.dataTypeEnum.int,
				"description": "X-coordinates of the element in pixels. \n\nDefault: 0.",
				"id": "map element_x"
			},
			"y": {
				"alias": "y",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Y-coordinates of the element in pixels. \n\nDefault: 0.",
				"id": "map element_y"
			}
		},
		"map link": {
			"linkid": {
				"alias": "linkid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map link.",
				"id": "map link_linkid"
			},
			"selementid1": {
				"alias": "selementid1",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the first map element linked on one end.",
				"id": "map link_selementid1"
			},
			"selementid2": {
				"alias": "selementid2",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the first map element linked on the other end.",
				"id": "map link_selementid2"
			},
			"color": {
				"alias": "color",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Line color as a hexadecimal color code. \n\nDefault: 000000.",
				"id": "map link_color"
			},
			"drawtype": {
				"alias": "drawtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Link line draw style. \n\nPossible values: \n0 - (default) line; \n2 - bold line; \n3 - dotted line; \n4 - dashed line.",
				"id": "map link_drawtype"
			},
			"label": {
				"alias": "label",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Link label.",
				"id": "map link_label"
			},
			"linktriggers": {
				"alias": "linktriggers",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Map link triggers to use as link status indicators. \n\nThe map link trigger object is described in detail below.",
				"id": "map link_linktriggers"
			},
			"sysmapid": {
				"alias": "sysmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map the link belongs to.",
				"id": "map link_sysmapid"
			}
		},
		"map lin k trigger": {
			"linktriggerid": {
				"alias": "linktriggerid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map link trigger.",
				"id": "map lin k trigger_linktriggerid"
			},
			"triggerid": {
				"alias": "triggerid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the trigger used as a link indicator.",
				"id": "map lin k trigger_triggerid"
			},
			"color": {
				"alias": "color",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Indicator color as a hexadecimal color code. \n\nDefault: DD0000.",
				"id": "map lin k trigger_color"
			},
			"drawtype": {
				"alias": "drawtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Indicator draw style. \n\nPossible values: \n0 - (default) line; \n2 - bold line; \n3 - dotted line; \n4 - dashed line.",
				"id": "map lin k trigger_drawtype"
			},
			"linkid": {
				"alias": "linkid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map link that the link trigger belongs to.",
				"id": "map lin k trigger_linkid"
			}
		},
		"map url": {
			"sysmapurlid": {
				"alias": "sysmapurlid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map URL.",
				"id": "map url_sysmapurlid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Link caption.",
				"id": "map url_name"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Link URL.",
				"id": "map url_url"
			},
			"elementtype": {
				"alias": "elementtype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of map element for which the URL will be available. \n\nRefer to the map element \"type\" property for a list of supported types. \n\nDefault: 0.",
				"id": "map url_elementtype"
			},
			"sysmapid": {
				"alias": "sysmapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map that the URL belongs to.",
				"id": "map url_sysmapid"
			}
		},
		"map user": {
			"sysmapuserid": {
				"alias": "sysmapuserid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map user.",
				"id": "map user_sysmapuserid"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User ID.",
				"id": "map user_userid"
			},
			"permission": {
				"alias": "permission",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of permission level. \n\nPossible values: \n2 - read only; \n3 - read-write;",
				"id": "map user_permission"
			}
		},
		"map user group": {
			"sysmapusrgrpid": {
				"alias": "sysmapusrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the map user group.",
				"id": "map user group_sysmapusrgrpid"
			},
			"usrgrpid": {
				"alias": "usrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User group ID.",
				"id": "map user group_usrgrpid"
			},
			"permission": {
				"alias": "permission",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of permission level. \n\nPossible values: \n2 - read only; \n3 - read-write;",
				"id": "map user group_permission"
			}
		},
		"usermedia": {
			"usermediaid": {
				"alias": "usermediaid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the media.",
				"id": "usermedia_mediaid"
			},
			"active": {
				"alias": "active",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the media is enabled. \n\nPossible values: \n0 - enabled; \n1 - disabled.",
				"id": "usermedia_active"
			},
			"usermediatypeid": {
				"alias": "usermediatypeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the media type used by the media.",
				"id": "usermedia_mediatypeid"
			},
			"period": {
				"alias": "period",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Time when the notifications can be sent as a time period.",
				"id": "usermedia_period"
			},
			"sendto": {
				"alias": "sendto",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Address, user name or other identifier of the recipient.",
				"id": "usermedia_sendto"
			},
			"severity": {
				"alias": "severity",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Trigger severities to send notifications about. \n\nSeverities are stored in binary form with each bit representing the corresponding severity. For example, 12 equals 1100 in binary and means, that notifications will be sent from triggers with severities warning and average. \n\nRefer to the trigger object page for a list of supported trigger severities.",
				"id": "usermedia_severity"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the user that uses the media.",
				"id": "usermedia_userid"
			}
		},
		"mediatype": {
			"usermediatypeid": {
				"alias": "usermediatypeid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the media type.",
				"id": "mediatype_mediatypeid"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the media type.",
				"id": "mediatype_description"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Transport used by the media type. \n\nPossible values: \n0 - email; \n1 - script; \n2 - SMS; \n3 - Jabber; \n100 - Ez Texting.",
				"id": "mediatype_type"
			},
			"exec_path": {
				"alias": "exec_path",
				"dataType": tableau.dataTypeEnum.string,
				"description": "For script media types exec_path contains the name of the executed script. \n\nFor Ez Texting exec_path contains the message text limit. \nPossible text limit values: \n0 - USA (160 characters); \n1 - Canada (136 characters). \n\nRequired for script and Ez Texting media types.",
				"id": "mediatype_exec_path"
			},
			"gsm_modem": {
				"alias": "gsm_modem",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Serial device name of the GSM modem. \n\nRequired for SMS media types.",
				"id": "mediatype_gsm_modem"
			},
			"passwd": {
				"alias": "passwd",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Authentication password. \n\nRequired for Jabber and Ez Texting media types.",
				"id": "mediatype_passwd"
			},
			"smtp_email": {
				"alias": "smtp_email",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Email address from which notifications will be sent. \n\nRequired for email media types.",
				"id": "mediatype_smtp_email"
			},
			"smtp_helo": {
				"alias": "smtp_helo",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SMTP HELO. \n\nRequired for email media types.",
				"id": "mediatype_smtp_helo"
			},
			"smtp_server": {
				"alias": "smtp_server",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SMTP server. \n\nRequired for email media types.",
				"id": "mediatype_smtp_server"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the media type is enabled. \n\nPossible values: \n0 - (default) enabled; \n1 - disabled.",
				"id": "mediatype_status"
			},
			"username": {
				"alias": "username",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Username or Jabber identifier. \n\nRequired for Jabber and Ez Texting media types.",
				"id": "mediatype_username"
			},
			"exec_params": {
				"alias": "exec_params",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Script parameters. \n\nEach parameter ends with a new line feed.",
				"id": "mediatype_exec_params"
			}
		},
		"problem": {
			"eventid": {
				"alias": "eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the problem event.",
				"id": "problem_eventid"
			},
			"source": {
				"alias": "source",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of the problem event. \n\nPossible values: \n0 - event created by a trigger; \n3 - internal event.",
				"id": "problem_source"
			},
			"object": {
				"alias": "object",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of object that is related to the problem event. \n\nPossible values for trigger events: \n0 - trigger. \n\nPossible values for internal events: \n0 - trigger; \n4 - item; \n5 - LLD rule.",
				"id": "problem_object"
			},
			"objectid": {
				"alias": "objectid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the related object.",
				"id": "problem_objectid"
			},
			"clock": {
				"alias": "clock",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the problem event was created.",
				"id": "problem_clock"
			},
			"ns": {
				"alias": "ns",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Nanoseconds when the problem event was created.",
				"id": "problem_ns"
			},
			"r_eventid": {
				"alias": "r_eventid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Recovery event ID.",
				"id": "problem_r_eventid"
			},
			"r_clock": {
				"alias": "r_clock",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the recovery event was created.",
				"id": "problem_r_clock"
			},
			"r_ns": {
				"alias": "r_ns",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Nanoseconds when the recovery event was created.",
				"id": "problem_r_ns"
			},
			"correlationid": {
				"alias": "correlationid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Correlation rule ID if this event was recovered by global correlation rule.",
				"id": "problem_correlationid"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User ID if the problem was manually closed.",
				"id": "problem_userid"
			}
		},
		"proxy": {
			"proxyid": {
				"alias": "proxyid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the proxy.",
				"id": "proxy_proxyid"
			},
			"host": {
				"alias": "host",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the proxy.",
				"id": "proxy_host"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of proxy. \n\nPossible values:\n5 - active proxy;\n6 - passive proxy.",
				"id": "proxy_status"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the proxy.",
				"id": "proxy_description"
			},
			"lastaccess": {
				"alias": "lastaccess",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the proxy last connected to the server.",
				"id": "proxy_lastaccess"
			},
			"tls_connect": {
				"alias": "tls_connect",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Connections to host. \n\nPossible values are: \n1 - (default) No encryption; \n2 - PSK; \n4 - certificate.",
				"id": "proxy_tls_connect"
			},
			"tls_accept": {
				"alias": "tls_accept",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Connections from host. \n\nPossible bitmap values are: \n1 - (default) No encryption; \n2 - PSK; \n4 - certificate.",
				"id": "proxy_tls_accept"
			},
			"tls_issuer": {
				"alias": "tls_issuer",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Certificate issuer.",
				"id": "proxy_tls_issuer"
			},
			"tls_subject": {
				"alias": "tls_subject",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Certificate subject.",
				"id": "proxy_tls_subject"
			},
			"tls_psk_identity": {
				"alias": "tls_psk_identity",
				"dataType": tableau.dataTypeEnum.string,
				"description": "PSK identity. Required if either tls_connect or tls_accept has PSK enabled.",
				"id": "proxy_tls_psk_identity"
			},
			"tls_psk": {
				"alias": "tls_psk",
				"dataType": tableau.dataTypeEnum.string,
				"description": "The preshared key, at least 32 hex digits. Required if either tls_connect or tls_accept has PSK enabled.",
				"id": "proxy_tls_psk"
			}
		},
		"proxy interface": {
			"interfaceid": {
				"alias": "interfaceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the interface.",
				"id": "proxy interface_interfaceid"
			},
			"dns": {
				"alias": "dns",
				"dataType": tableau.dataTypeEnum.string,
				"description": "DNS name to connect to. \n\nCan be empty if connections are made via IP address.",
				"id": "proxy interface_dns"
			},
			"ip": {
				"alias": "ip",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IP address to connect to. \n\nCan be empty if connections are made via DNSnames.",
				"id": "proxy interface_ip"
			},
			"port": {
				"alias": "port",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Port number to connect to.",
				"id": "proxy interface_port"
			},
			"useip": {
				"alias": "useip",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the connection should be made via IP address. \n\nPossible values are: \n0 - connect using DNS name; \n1 - connect using IP address.",
				"id": "proxy interface_useip"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the proxy the interface belongs to.",
				"id": "proxy interface_hostid"
			}
		},
		"screen": {
			"screenid": {
				"alias": "screenid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the screen.",
				"id": "screen_screenid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the screen.",
				"id": "screen_name"
			},
			"hsize": {
				"alias": "hsize",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the screen. \n\nDefault: 1",
				"id": "screen_hsize"
			},
			"vsize": {
				"alias": "vsize",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the screen. \n\nDefault: 1",
				"id": "screen_vsize"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Screen owner user ID.",
				"id": "screen_userid"
			},
			"private": {
				"alias": "private",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of screen sharing. \n\nPossible values: \n0 - public screen; \n1 - (default) private screen.",
				"id": "screen_private"
			}
		},
		"screen user": {
			"screenuserid": {
				"alias": "screenuserid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the screen user.",
				"id": "screen user_screenuserid"
			},
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User ID.",
				"id": "screen user_userid"
			},
			"permission": {
				"alias": "permission",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of permission level. \n\nPossible values: \n2 - read only; \n3 - read-write;",
				"id": "screen user_permission"
			}
		},
		"screen user group": {
			"screenusrgrpid": {
				"alias": "screenusrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the screen user group.",
				"id": "screen user group_screenusrgrpid"
			},
			"usrgrpid": {
				"alias": "usrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User group ID.",
				"id": "screen user group_usrgrpid"
			},
			"permission": {
				"alias": "permission",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of permission level. \n\nPossible values: \n2 - read only; \n3 - read-write;",
				"id": "screen user group_permission"
			}
		},
		"screenitem": {
			"screenitemid": {
				"alias": "screenitemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the screen item.",
				"id": "screenitem_screenitemid"
			},
			"resourcetype": {
				"alias": "resourcetype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of screen item. \n\nPossible values: \n0 - graph; \n1 - simple graph; \n2 - map; \n3 - plain text; \n4 - hosts info; \n5 - triggers info; \n6 - status of Zabbix; \n7 - clock; \n8 - screen; \n9 - triggers overview \n10 - data overview; \n11 - URL; \n12 - history of actions; \n13 - history of events; \n14 - latest host group issues; \n15 - system status; \n16 - latest host issues; \n19 - simple graph prototype; \n20 - graph prototype.",
				"id": "screenitem_resourcetype"
			},
			"screenid": {
				"alias": "screenid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the screen that the item belongs to.",
				"id": "screenitem_screenid"
			},
			"application": {
				"alias": "application",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Application or part of application name by which data in screen item can be filtered. Applies to resource types: “Data overview” and “Triggers overview”. ",
				"id": "screenitem_application"
			},
			"colspan": {
				"alias": "colspan",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of columns the screen item will span across. \n\nDefault: 1.",
				"id": "screenitem_colspan"
			},
			"dynamic": {
				"alias": "dynamic",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the screen item is dynamic. \n\nPossible values: \n0 - (default) not dynamic; \n1 - dynamic.",
				"id": "screenitem_dynamic"
			},
			"elements": {
				"alias": "elements",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of lines to display on the screen item. \n\nDefault: 25.",
				"id": "screenitem_elements"
			},
			"halign": {
				"alias": "halign",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies how the screen item must be aligned horizontally in the cell. \n\nPossible values: \n0 - (default) center; \n1 - left; \n2 - right.",
				"id": "screenitem_halign"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the screen item in pixels. \n\nDefault: 200.",
				"id": "screenitem_height"
			},
			"max_columns": {
				"alias": "max_columns",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies the maximum amount of columns a graph prototype or simple graph prototype screen element can have. \n\nDefault: 3.",
				"id": "screenitem_max_columns"
			},
			"resourceid": {
				"alias": "resourceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the object displayed on the screen item. Depending on the type of a screen item, the resourceid property can reference different objects. \n\nRequired for data overview, graph, map, plain text, screen, simple graph and trigger overview screen items. Unused by local and server time clocks, history of actions, history of events, hosts info, status of Zabbix, system status and URL screen items.",
				"id": "screenitem_resourceid"
			},
			"rowspan": {
				"alias": "rowspan",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number or rows the screen item will span across. \n\nDefault: 1.",
				"id": "screenitem_rowspan"
			},
			"sort_triggers": {
				"alias": "sort_triggers",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Order in which actions or triggers must be sorted. \n\nPossible values for history of actions screen elements: \n3 - time, ascending; \n4 - time, descending; \n5 - type, ascending; \n6 - type, descending; \n7 - status, ascending; \n8 - status, descending; \n9 - retries left, ascending; \n10 - retries left, descending; \n11 - recipient, ascending; \n12 - recipient, descending. \n\nPossible values for latest host group issues and latest host issues screen items: \n0 - (default) last change, descending; \n1 - severity, descending; \n2 - host, ascending.",
				"id": "screenitem_sort_triggers"
			},
			"style": {
				"alias": "style",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Screen item display option. \n\nPossible values for data overview and triggers overview screen items: \n0 - (default) display hosts on the left side; \n1 - display hosts on the top. \n\nPossible values for hosts info and triggers info screen elements: \n0 - (default) horizontal layout; \n1 - vertical layout. \n\nPossible values for clock screen items: \n0 - (default) local time; \n1 - server time; \n2 - host time. \n\nPossible values for plain text screen items: \n0 - (default) display values as plain text; \n1 - display values as HTML.",
				"id": "screenitem_style"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL of the webpage to be displayed in the screen item. Used by URL screen items.",
				"id": "screenitem_url"
			},
			"valign": {
				"alias": "valign",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies how the screen item must be aligned vertically in the cell. \n\nPossible values: \n0 - (default) middle; \n1 - top; \n2 - bottom.",
				"id": "screenitem_valign"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the screen item in pixels. \n\nDefault: 320.",
				"id": "screenitem_width"
			},
			"x": {
				"alias": "x",
				"dataType": tableau.dataTypeEnum.int,
				"description": "X-coordinates of the screen item on the screen, from left to right. \n\nDefault: 0.",
				"id": "screenitem_x"
			},
			"y": {
				"alias": "y",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Y-coordinates of the screen item on the screen, from top to bottom. \n\nDefault: 0.",
				"id": "screenitem_y"
			}
		},
		"script": {
			"scriptid": {
				"alias": "scriptid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the script.",
				"id": "script_scriptid"
			},
			"command": {
				"alias": "command",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Command to run.",
				"id": "script_command"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the script.",
				"id": "script_name"
			},
			"confirmation": {
				"alias": "confirmation",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Confirmation pop up text. The pop up will appear when trying to run the script from the Zabbix frontend.",
				"id": "script_confirmation"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the script.",
				"id": "script_description"
			},
			"execute_on": {
				"alias": "execute_on",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Where to run the script. \n\nPossible values: \n0 - run on Zabbix agent; \n1 - (default) run on Zabbix server.",
				"id": "script_execute_on"
			},
			"groupid": {
				"alias": "groupid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host group that the script can be run on. If set to 0, the script will be available on all host groups. \n\nDefault: 0.",
				"id": "script_groupid"
			},
			"host_access": {
				"alias": "host_access",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Host permissions needed to run the script. \n\nPossible values: \n2 - (default) read; \n3 - write.",
				"id": "script_host_access"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Script type. \n\nPossible values: \n0 - (default) script; \n1 - IPMI.",
				"id": "script_type"
			},
			"usrgrpid": {
				"alias": "usrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the user group that will be allowed to run the script. If set to 0, the script will be available for all user groups. \n\nDefault: 0.",
				"id": "script_usrgrpid"
			}
		},
		"template": {
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the template.",
				"id": "template_templateid"
			},
			"host": {
				"alias": "host",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Technical name of the template.",
				"id": "template_host"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Description of the template.",
				"id": "template_description"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Visible name of the host. \n\nDefault: host property value.",
				"id": "template_name"
			}
		},
		"templatescreen": {
			"screenid": {
				"alias": "screenid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the template screen.",
				"id": "templatescreen_screenid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the template screen.",
				"id": "templatescreen_name"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the template that the screen belongs to.",
				"id": "templatescreen_templateid"
			},
			"hsize": {
				"alias": "hsize",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the template screen. \n\nDefault: 1",
				"id": "templatescreen_hsize"
			},
			"vsize": {
				"alias": "vsize",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the template screen. \n\nDefault: 1",
				"id": "templatescreen_vsize"
			}
		},
		"templatescreenitem": {
			"screenitemid": {
				"alias": "screenitemid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the template screen item.",
				"id": "templatescreenitem_screenitemid"
			},
			"resourceid": {
				"alias": "resourceid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the object from the parent template displayed on the template screen item. Depending on the type of screen item, the resourceid property can reference different objects. Unused by clock and URL template screen items. \n\nNote: the resourceid property always references an object used in the parent template object, even if the screen item itself is inherited on a host or template.",
				"id": "templatescreenitem_resourceid"
			},
			"resourcetype": {
				"alias": "resourcetype",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of template screen item. \n\nPossible values: \n0 - graph; \n1 - simple graph; \n3 - plain text; \n7 - clock; \n11 - URL; \n19 - simple graph prototype; \n20 - graph prototype.",
				"id": "templatescreenitem_resourcetype"
			},
			"screenid": {
				"alias": "screenid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the template screen that the item belongs to.",
				"id": "templatescreenitem_screenid"
			},
			"colspan": {
				"alias": "colspan",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of columns the template screen item will span across. \n\nDefault: 1.",
				"id": "templatescreenitem_colspan"
			},
			"elements": {
				"alias": "elements",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of lines to display on the template screen item. \n\nDefault: 25.",
				"id": "templatescreenitem_elements"
			},
			"halign": {
				"alias": "halign",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies how the template screen item must be aligned horizontally in the cell. \n\nPossible values: \n0 - (default) center; \n1 - left; \n2 - right.",
				"id": "templatescreenitem_halign"
			},
			"height": {
				"alias": "height",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Height of the template screen item in pixels. \n\nDefault: 200.",
				"id": "templatescreenitem_height"
			},
			"max_columns": {
				"alias": "max_columns",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies the maximum amount of columns a graph prototype or simple graph prototype screen element can have. \n\nDefault: 3.",
				"id": "templatescreenitem_max_columns"
			},
			"rowspan": {
				"alias": "rowspan",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number or rows the template screen item will span across. \n\nDefault: 1.",
				"id": "templatescreenitem_rowspan"
			},
			"style": {
				"alias": "style",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Template screen item display option. \n\nPossible values for clock screen items: \n0 - (default) local time; \n1 - server time; \n2 - host time. \n\nPossible values for plain text screen items: \n0 - (default) display values as plain text; \n1 - display values as HTML.",
				"id": "templatescreenitem_style"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL of the webpage to be displayed in the template screen item. Used by URL template screen items.",
				"id": "templatescreenitem_url"
			},
			"valign": {
				"alias": "valign",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Specifies how the template screen item must be aligned vertically in the cell. \n\nPossible values: \n0 - (default) middle; \n1 - top; \n2 - bottom.",
				"id": "templatescreenitem_valign"
			},
			"width": {
				"alias": "width",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Width of the template screen item in pixels. \n\nDefault: 320.",
				"id": "templatescreenitem_width"
			},
			"x": {
				"alias": "x",
				"dataType": tableau.dataTypeEnum.int,
				"description": "X-coordinates of the template screen item on the screen, from left to right. \n\nDefault: 0.",
				"id": "templatescreenitem_x"
			},
			"y": {
				"alias": "y",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Y-coordinates of the template screen item on the screen, from top to bottom. \n\nDefault: 0.",
				"id": "templatescreenitem_y"
			}
		},
		"trend": {
			"float": {
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "trend_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "trend_itemid"
				},
				"num": {
					"alias": "num",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Number of values within this hour.",
					"id": "trend_num"
				},
				"value_min": {
					"alias": "value_min",
					"dataType": tableau.dataTypeEnum.float,
					"description": "Hourly minimum value.",
					"id": "trend_value_min"
				},
				"value_avg": {
					"alias": "value_avg",
					"dataType": tableau.dataTypeEnum.float,
					"description": "Hourly average value.",
					"id": "trend_value_avg"
				},
				"value_max": {
					"alias": "value_max",
					"dataType": tableau.dataTypeEnum.float,
					"description": "Hourly maximum value.",
					"id": "trend_value_max"
				}
			},
			"int": {
				"clock": {
					"alias": "clock",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Time when that value was received.",
					"id": "trend_clock"
				},
				"itemid": {
					"alias": "itemid",
					"dataType": tableau.dataTypeEnum.int,
					"description": "ID of the related item.",
					"id": "trend_itemid"
				},
				"num": {
					"alias": "num",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Number of values within this hour.",
					"id": "trend_num"
				},
				"value_min": {
					"alias": "value_min",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Hourly minimum value.",
					"id": "trend_value_min"
				},
				"value_avg": {
					"alias": "value_avg",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Hourly average value.",
					"id": "trend_value_avg"
				},
				"value_max": {
					"alias": "value_max",
					"dataType": tableau.dataTypeEnum.int,
					"description": "Hourly maximum value.",
					"id": "trend_value_max"
				}
			}
		},
		"trigger": {
			"triggerid": {
				"alias": "triggerid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the trigger.",
				"id": "trigger_triggerid"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the trigger.",
				"id": "trigger_description"
			},
			"expression": {
				"alias": "expression",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Reduced trigger expression.",
				"id": "trigger_expression"
			},
			"comments": {
				"alias": "comments",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Additional comments to the trigger.",
				"id": "trigger_comments"
			},
			"error": {
				"alias": "error",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Error text if there have been any problems when updating the state of the trigger.",
				"id": "trigger_error"
			},
			"flags": {
				"alias": "flags",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Origin of the trigger. \n\nPossible values are: \n0 - (default) a plain trigger; \n4 - a discovered trigger.",
				"id": "trigger_flags"
			},
			"lastchange": {
				"alias": "lastchange",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time when the trigger last changed its state.",
				"id": "trigger_lastchange"
			},
			"priority": {
				"alias": "priority",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Severity of the trigger. \n\nPossible values are: \n0 - (default) not classified; \n1 - information; \n2 - warning; \n3 - average; \n4 - high; \n5 - disaster.",
				"id": "trigger_priority"
			},
			"state": {
				"alias": "state",
				"dataType": tableau.dataTypeEnum.int,
				"description": "State of the trigger. \n\nPossible values: \n0 - (default) trigger state is up to date; \n1 - current trigger state is unknown.",
				"id": "trigger_state"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the trigger is enabled or disabled. \n\nPossible values are: \n0 - (default) enabled; \n1 - disabled.",
				"id": "trigger_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template trigger.",
				"id": "trigger_templateid"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the trigger can generate multiple problem events. \n\nPossible values are: \n0 - (default) do not generate multiple events; \n1 - generate multiple events.",
				"id": "trigger_type"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL associated with the trigger.",
				"id": "trigger_url"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the trigger is in OK or problem state. \n\nPossible values are: \n0 - (default) OK; \n1 - problem.",
				"id": "trigger_value"
			},
			"recovery_mode": {
				"alias": "recovery_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "OK event generation mode. \n\nPossible values are: \n0 - (default) Expression; \n1 - Recovery expression; \n2 - None.",
				"id": "trigger_recovery_mode"
			},
			"recovery_expression": {
				"alias": "recovery_expression",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Reduced trigger recovery expression.",
				"id": "trigger_recovery_expression"
			},
			"correlation_mode": {
				"alias": "correlation_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "OK event closes. \n\nPossible values are: \n0 - (default) All problems; \n1 - All problems if tag values match.",
				"id": "trigger_correlation_mode"
			},
			"correlation_tag": {
				"alias": "correlation_tag",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Tag for matching.",
				"id": "trigger_correlation_tag"
			},
			"manual_close": {
				"alias": "manual_close",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Allow manual close. \n\nPossible values are: \n0 - (default) No; \n1 - Yes.",
				"id": "trigger_manual_close"
			}
		},
		"triggerprototype": {
			"triggerid": {
				"alias": "triggerid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the trigger prototype.",
				"id": "triggerprototype_triggerid"
			},
			"description": {
				"alias": "description",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the trigger prototype.",
				"id": "triggerprototype_description"
			},
			"expression": {
				"alias": "expression",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Reduced trigger expression.",
				"id": "triggerprototype_expression"
			},
			"comments": {
				"alias": "comments",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Additional comments to the trigger prototype.",
				"id": "triggerprototype_comments"
			},
			"priority": {
				"alias": "priority",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Severity of the trigger prototype. \n\nPossible values: \n0 - (default) not classified; \n1 - information; \n2 - warning; \n3 - average; \n4 - high; \n5 - disaster.",
				"id": "triggerprototype_priority"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the trigger prototype is enabled or disabled. \n\nPossible values: \n0 - (default) enabled; \n1 - disabled.",
				"id": "triggerprototype_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template trigger prototype.",
				"id": "triggerprototype_templateid"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the trigger prototype can generate multiple problem events. \n\nPossible values: \n0 - (default) do not generate multiple events; \n1 - generate multiple events.",
				"id": "triggerprototype_type"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL associated with the trigger prototype.",
				"id": "triggerprototype_url"
			},
			"recovery_mode": {
				"alias": "recovery_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "OK event generation mode. \n\nPossible values are: \n0 - (default) Expression; \n1 - Recovery expression; \n2 - None.",
				"id": "triggerprototype_recovery_mode"
			},
			"recovery_expression": {
				"alias": "recovery_expression",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Reduced trigger recovery expression.",
				"id": "triggerprototype_recovery_expression"
			},
			"correlation_mode": {
				"alias": "correlation_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "OK event closes. \n\nPossible values are: \n0 - (default) All problems; \n1 - All problems if tag values match.",
				"id": "triggerprototype_correlation_mode"
			},
			"correlation_tag": {
				"alias": "correlation_tag",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Tag for matching.",
				"id": "triggerprototype_correlation_tag"
			},
			"manual_close": {
				"alias": "manual_close",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Allow manual close. \n\nPossible values are: \n0 - (default) No; \n1 - Yes.",
				"id": "triggerprototype_manual_close"
			}
		},
		"user": {
			"userid": {
				"alias": "userid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the user.",
				"id": "user_userid"
			},
			"alias": {
				"alias": "alias",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User alias.",
				"id": "user_alias"
			},
			"attempt_clock": {
				"alias": "attempt_clock",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time of the last unsuccessful login attempt.",
				"id": "user_attempt_clock"
			},
			"attempt_failed": {
				"alias": "attempt_failed",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Recent failed login attempt count.",
				"id": "user_attempt_failed"
			},
			"attempt_ip": {
				"alias": "attempt_ip",
				"dataType": tableau.dataTypeEnum.string,
				"description": "IP address from where the last unsuccessful login attempt came from.",
				"id": "user_attempt_ip"
			},
			"autologin": {
				"alias": "autologin",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to enable auto-login. \n\nPossible values: \n0 - (default) auto-login disabled; \n1 - auto-login enabled.",
				"id": "user_autologin"
			},
			"autologout": {
				"alias": "autologout",
				"dataType": tableau.dataTypeEnum.int,
				"description": "User session life time in seconds. If set to 0, the session will never expire. \n\nDefault: 900.",
				"id": "user_autologout"
			},
			"lang": {
				"alias": "lang",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Language code of the user's language. \n\nDefault: en_GB.",
				"id": "user_lang"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the user.",
				"id": "user_name"
			},
			"refresh": {
				"alias": "refresh",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Automatic refresh period in seconds. \n\nDefault: 30.",
				"id": "user_refresh"
			},
			"rows_per_page": {
				"alias": "rows_per_page",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Amount of object rows to show per page. \n\nDefault: 50.",
				"id": "user_rows_per_page"
			},
			"surname": {
				"alias": "surname",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Surname of the user.",
				"id": "user_surname"
			},
			"theme": {
				"alias": "theme",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User's theme. \n\nPossible values: \ndefault - (default) system default; \nblue-theme - Blue; \ndark-theme - Dark.",
				"id": "user_theme"
			},
			"type": {
				"alias": "type",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Type of the user. \n\nPossible values: \n1 - (default) Zabbix user; \n2 - Zabbix admin; \n3 - Zabbix super admin.",
				"id": "user_type"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL of the page to redirect the user to after logging in.",
				"id": "user_url"
			}
		},
		"usergroup": {
			"usrgrpid": {
				"alias": "usrgrpid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the user group.",
				"id": "usergroup_usrgrpid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the user group.",
				"id": "usergroup_name"
			},
			"debug_mode": {
				"alias": "debug_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether debug mode is enabled or disabled. \n\nPossible values are: \n0 - (default) disabled; \n1 - enabled.",
				"id": "usergroup_debug_mode"
			},
			"gui_access": {
				"alias": "gui_access",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Frontend authentication method of the users in the group. \n\nPossible values: \n0 - (default) use the system default authentication method; \n1 - use internal authentication; \n2 - disable access to the frontend.",
				"id": "usergroup_gui_access"
			},
			"users_status": {
				"alias": "users_status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the user group is enabled or disabled. \n\nPossible values are: \n0 - (default) enabled; \n1 - disabled.",
				"id": "usergroup_users_status"
			}
		},
		"permission": {
			"id": {
				"alias": "id",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host group to add permission to.",
				"id": "permission_id"
			},
			"permission": {
				"alias": "permission",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Access level to the host group. \n\nPossible values: \n0 - access denied; \n2 - read-only access; \n3 - read-write access.",
				"id": "permission_permission"
			}
		},
		"global macro": {
			"globalmacroid": {
				"alias": "globalmacroid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the global macro.",
				"id": "global macro_globalmacroid"
			},
			"macro": {
				"alias": "macro",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Macro string.",
				"id": "global macro_macro"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value of the macro.",
				"id": "global macro_value"
			}
		},
		"host macro": {
			"hostmacroid": {
				"alias": "hostmacroid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host macro.",
				"id": "host macro_hostmacroid"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host that the macro belongs to.",
				"id": "host macro_hostid"
			},
			"macro": {
				"alias": "macro",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Macro string.",
				"id": "host macro_macro"
			},
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value of the macro.",
				"id": "host macro_value"
			}
		},
		"valuemap": {
			"valuemapid": {
				"alias": "valuemapid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the value map.",
				"id": "valuemap_valuemapid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the value map.",
				"id": "valuemap_name"
			},
			"mappings": {
				"alias": "mappings",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value mappings for current value map. The mapping object is described in detail below.",
				"id": "valuemap_mappings"
			}
		},
		"valuemappings": {
			"value": {
				"alias": "value",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Original value.",
				"id": "valuemappings_value"
			},
			"newvalue": {
				"alias": "newvalue",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Value to which the original value is mapped to.",
				"id": "valuemappings_newvalue"
			}
		},
		"httptest": {
			"httptestid": {
				"alias": "httptestid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the web scenario.",
				"id": "httptest_httptestid"
			},
			"hostid": {
				"alias": "hostid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the host that the web scenario belongs to.",
				"id": "httptest_hostid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the web scenario.",
				"id": "httptest_name"
			},
			"agent": {
				"alias": "agent",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User agent string that will be used by the web scenario.\n\nDefault: Zabbix",
				"id": "httptest_agent"
			},
			"applicationid": {
				"alias": "applicationid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the application that the web scenario belongs to.",
				"id": "httptest_applicationid"
			},
			"authentication": {
				"alias": "authentication",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Authentication method that will be used by the web scenario. \n\nPossible values: \n0 - (default) none; \n1 - basic HTTP authentication; \n2 - NTLM authentication.",
				"id": "httptest_authentication"
			},
			"delay": {
				"alias": "delay",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Execution interval of the web scenario in seconds. \n\nDefault: 60.",
				"id": "httptest_delay"
			},
			"headers": {
				"alias": "headers",
				"dataType": tableau.dataTypeEnum.string,
				"description": "HTTP headers that will be sent when performing a request.",
				"id": "httptest_headers"
			},
			"http_password": {
				"alias": "http_password",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Password used for authentication. \n\nRequired for web scenarios with basic HTTP or NTLM authentication.",
				"id": "httptest_http_password"
			},
			"http_proxy": {
				"alias": "http_proxy",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Proxy that will be used by the web scenario given as http:[username[:password]@]proxy.example.com[:port].",
				"id": "httptest_http_proxy"
			},
			"http_user": {
				"alias": "http_user",
				"dataType": tableau.dataTypeEnum.string,
				"description": "User name used for authentication. \n\nRequired for web scenarios with basic HTTP or NTLM authentication.",
				"id": "httptest_http_user"
			},
			"nextcheck": {
				"alias": "nextcheck",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Time of the next web scenario execution.",
				"id": "httptest_nextcheck"
			},
			"retries": {
				"alias": "retries",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Number of times a web scenario will try to execute each step before failing. \n\nDefault: 1.",
				"id": "httptest_retries"
			},
			"ssl_cert_file": {
				"alias": "ssl_cert_file",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the SSL certificate file used for client authentication (must be in PEM format).",
				"id": "httptest_ssl_cert_file"
			},
			"ssl_key_file": {
				"alias": "ssl_key_file",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the SSL private key file used for client authentication (must be in PEM format).",
				"id": "httptest_ssl_key_file"
			},
			"ssl_key_password": {
				"alias": "ssl_key_password",
				"dataType": tableau.dataTypeEnum.string,
				"description": "SSL private key password.",
				"id": "httptest_ssl_key_password"
			},
			"status": {
				"alias": "status",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether the web scenario is enabled. \n\nPossible values are: \n0 - (default) enabled; \n1 - disabled.",
				"id": "httptest_status"
			},
			"templateid": {
				"alias": "templateid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the parent template web scenario.",
				"id": "httptest_templateid"
			},
			"variables": {
				"alias": "variables",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Web scenario variables.",
				"id": "httptest_variables"
			},
			"verify_host": {
				"alias": "verify_host",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to verify that the host name specified in the SSL certificate matches the one used in the scenario. \n\nPossible values are: \n0 - (default) skip host verification; \n1 - verify host.",
				"id": "httptest_verify_host"
			},
			"verify_peer": {
				"alias": "verify_peer",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to verify the SSL certificate of the web server. \n\nPossible values are: \n0 - (default) skip peer verification; \n1 - verify peer.",
				"id": "httptest_verify_peer"
			}
		},
		"scenario step": {
			"httpstepid": {
				"alias": "httpstepid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the scenario step.",
				"id": "scenario step_httpstepid"
			},
			"name": {
				"alias": "name",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Name of the scenario step.",
				"id": "scenario step_name"
			},
			"no": {
				"alias": "no",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Sequence number of the step in a web scenario.",
				"id": "scenario step_no"
			},
			"url": {
				"alias": "url",
				"dataType": tableau.dataTypeEnum.string,
				"description": "URL to be checked.",
				"id": "scenario step_url"
			},
			"follow_redirects": {
				"alias": "follow_redirects",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Whether to follow HTTP redirects. \n\nPossible values are: \n0 - don't follow redirects; \n1 - (default) follow redirects.",
				"id": "scenario step_follow_redirects"
			},
			"headers": {
				"alias": "headers",
				"dataType": tableau.dataTypeEnum.string,
				"description": "HTTP headers that will be sent when performing a request. Scenario step headers will overwrite headers specified for the web scenario.",
				"id": "scenario step_headers"
			},
			"httptestid": {
				"alias": "httptestid",
				"dataType": tableau.dataTypeEnum.int,
				"description": "ID of the web scenario that the step belongs to.",
				"id": "scenario step_httptestid"
			},
			"posts": {
				"alias": "posts",
				"dataType": tableau.dataTypeEnum.string,
				"description": "HTTP POST variables as a string.",
				"id": "scenario step_posts"
			},
			"required": {
				"alias": "required",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Text that must be present in the response.",
				"id": "scenario step_required"
			},
			"retrieve_mode": {
				"alias": "retrieve_mode",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Part of the HTTP response that the scenario step must retrieve. \n\nPossible values are: \n0 - (default) only body; \n1 - only headers.",
				"id": "scenario step_retrieve_mode"
			},
			"status_codes": {
				"alias": "status_codes",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Ranges of required HTTP status codes separated by commas.",
				"id": "scenario step_status_codes"
			},
			"timeout": {
				"alias": "timeout",
				"dataType": tableau.dataTypeEnum.int,
				"description": "Request timeout in seconds. \n\nDefault: 15.",
				"id": "scenario step_timeout"
			},
			"variables": {
				"alias": "variables",
				"dataType": tableau.dataTypeEnum.string,
				"description": "Scenario step variables.",
				"id": "scenario step_variables"
			}
		}
	}
})();
