(function () {
    var myConnector = tableau.makeConnector();

    myConnector.getSchema = function (schemaCallback) {

		var data = JSON.parse(tableau.connectionData);
		tableau.log(data);

		server = new $.jqzabbix({url:data.url,limit:1});

		server.getApiVersion();

		server.setAuth(data.auth);
		
		server.setOptions({timeout:60000})

		var tableInfo = new Array();

		var jobs = 0;

		parseCols = function(response, status, method) {
			var cols = [];
			if (Array.isArray(response.result)) {
				for (var key in response.result[0]) {
				   cols.push({id:key,alias:key,dataType:tableau.dataTypeEnum.string}); 
				};
			};
			tableInfo.push({id:method,alias:method,columns:cols});
			jobs--;
			tableau.log(tableInfo);
		};
		
		apiCall = function(method,params){
			server.sendAjaxRequest(method+'.get',params,function(a,b){parseCols(a,b,method)},errorMethod(server));
		};
		
		for (var i = 0, len = data.apiCalls.length; i < len; i++) {
			jobs++;
			var n = i;
			apiCall(data.apiCalls[n].method,data.apiCalls[n].params)
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
            table.appendRows(response.result);
            doneCallback();
        }
        var data = JSON.parse(tableau.connectionData);

        server = new $.jqzabbix(data);

        server.setAuth(data.auth);
		
		var apiCall = data.apiCalls.filter(function(a){return table.tableInfo.alias == a.method})


        server.sendAjaxRequest(apiCall[0].method+'.get',apiCall[0].params,parseData,errorMethod(server));
    };

    errorMethod = function(server) {

        var errormsg = [];

        $.each(server.isError(), function(key, value) {
            errormsg.push({key:key, value:value});
        });

        tableau.log(errormsg);
    }

    setupConnector = function() {
        var options = {
            'url': $('#url').val().trim(),
            'user':$('#user').val().trim(),
            'password':$('#password').val().trim()
        };

        server = new $.jqzabbix(options);
        server.getApiVersion();
        server.userLogin(null,getToken);
        //tableau.connectionData = JSON.stringify(zabbixConnection);
        //tableau.connectionName = 'Zabbix';
        //tableau.submit();
    };

    getToken = function(response, status) {
        var options = {
            'url': $('#url').val().trim(),
            'auth': response.result,
            apiCalls:[]
        };

        for (var i = 1; i <= counter; i++) {
            options.apiCalls.push({method:$('#method'+i).val().trim(),params:JSON.parse($('#params'+i).val().trim())});
        };
	
        tableau.connectionData = JSON.stringify(options);
        tableau.connectionName = 'Zabbix';
        tableau.submit();
    };

    tableau.registerConnector(myConnector);

    var counter = 1;
    var limit = 3;
    addInput = function(divName){
          counter++;
          var newdiv = document.createElement('div');
          newdiv.innerHTML = "<fieldset><legend>API Call " + counter + "</legend><input type=\"text\" id=\"method"+counter+"\" class=\"form-control\" placeholder=\"host\"><input type=\"text\" id=\"params"+counter+"\" class=\"form-control\" id=\"params\" placeholder=\"{}\"></fieldset>";
          document.getElementById(divName).appendChild(newdiv);
     }

    $(document).ready(function () {
        $("#submitButton").click(function () {
            setupConnector();
        });
        $('#zabbixForm').submit(function(event) {
            event.preventDefault();
            setupConnector();
        });
    });
})();
