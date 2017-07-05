(function () {
    var myConnector = tableau.makeConnector();

	var options = new Object();

    myConnector.getSchema = function (schemaCallback) {

		var data = JSON.parse(tableau.connectionData);
		tableau.log(data);

		server = new $.jqzabbix({url:data.url,limit:1});

		server.getApiVersion();

		server.setAuth(data.auth);
		
		server.setOptions({timeout:300000})

		var tableInfo = new Array();

		var jobs = 0;

		parseCols = function(response, status, apiCall) {
			var cols = [];
			if (Array.isArray(response.result)) {
				for (var key in response.result[0]) {
				   cols.push({id:key,alias:key,dataType:tableau.dataTypeEnum.string}); 
				};
			};
			tableInfo.push({id:apiCall.id,alias:apiCall.alias,description:apiCall.description,columns:cols});
			jobs--;
			tableau.log(tableInfo);
		};
		
		apiCall = function(apiCall){
			server.sendAjaxRequest(apiCall.method+'.get',apiCall.params,function(a,b){parseCols(a,b,apiCall)},errorMethod);
		};
		
		for (var i = 0, len = data.apiCalls.length; i < len; i++) {
			jobs++;
			var n = i;
			apiCall(data.apiCalls[n])
		};

		waitForComplete = function() {
			//tableau.log(jobs);
			if (jobs == 0) {
				schemaCallback(tableInfo);
			} else {
				setTimeout(waitForComplete,1000);
				tableau.log('waiting');
			}
		};
		
		setTimeout(waitForComplete,2000); 
	
	};

    myConnector.getData = function (table, doneCallback) {
        parseData = function (response, status) {
			tableau.reportProgress('Parsing Data')
            table.appendRows(response.result);
            doneCallback();
        }
        var data = JSON.parse(tableau.connectionData);

        server = new $.jqzabbix(data);

        server.setAuth(data.auth);
		
		var apiCall = data.apiCalls.filter(function(a){return table.tableInfo.id == a.id})


        server.sendAjaxRequest(apiCall[0].method+'.get',apiCall[0].params,parseData,errorMethod);
    };

    errorMethod = function(response,status) {

        tableau.abortWithError(response);
    }

    setupConnector = function(callBack) {
        var options = {
            'url': $('#url').val().trim(),
            'user':$('#user').val().trim(),
            'password':$('#password').val().trim()
        };

        server = new $.jqzabbix(options);
        server.getApiVersion();
        server.userLogin(null,function(r,s){getToken(r,s,callBack)});
        //tableau.connectionData = JSON.stringify(zabbixConnection);
        //tableau.connectionName = 'Zabbix';
        //tableau.submit();
    };

    getToken = function(response, status, callBack) {
        options = {
            'url': $('#url').val().trim(),
            'auth': response.result,
            apiCalls:[]
        };
		
		tableau.connectionName = $('#connectionName').val().trim();
		
		$('#connTabs').hide();
		$('#apiTabs').show();
		
		if (callBack) {
			callBack(options);
		} else { 
			return;
		};
	};
	
	submitConnector = function() {
		getAPICalls();
	};

	getAPICalls = function() {
        for (var i = 1; i <= counter; i++) {
            options.apiCalls.push({id:i.toString(),alias:$('#alias'+i).val().trim(),description:$('#description'+i).val().trim(),method:$('#method'+i).val().trim(),params:JSON.parse($('#params'+i).val().trim())});
        };
	
        tableau.connectionData = JSON.stringify(options);
        tableau.submit();
    };

    tableau.registerConnector(myConnector);

    var counter = 1;
    var limit = 3;
    addTab = function(){
		console.log('addTab')
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
		 console.log(tabName)
		 for (var i = 1, len = counter+1; i < len; i++) {
			$('#table'+i+'Tab').hide();
		 };
		 $(tabName).show();
	 };

    $(document).ready(function () {
        $("#connect").click(function () {
            setupConnector();
        });
        $('#zabbixForm').submit(function(event) {
            event.preventDefault();
            setupConnector();
        });
    });
})();
