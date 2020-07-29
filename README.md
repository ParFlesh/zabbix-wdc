# zabbix-wdc
Tableau Web Data Connector for Zabbix using [jpZabbix](https://github.com/ParFlesh/jpZabbix) by [ParFlesh](https://github.com/ParFlesh)


## Usage
Using either Tableau Desktop (10+) or Tableau Public (10+) add a new data source using Web Data Connector.

Enter `https://parflesh.github.io/zabbix-wdc/index.html` for the web data connector url.   

![image](https://user-images.githubusercontent.com/10260601/28503669-bbdf327c-6fd0-11e7-853c-7bf4d548c81e.png)   

After updating the form with informations relevant to your zabbix instance click "Connect".    
At this time the web data connector will authenticate to the API and will proceed to the next page if successful.    
The zabbix-wdc will save the authentication token for use later to get data.    

![image](https://user-images.githubusercontent.com/10260601/28503738-b28b09d4-6fd1-11e7-91fd-b17bb387197a.png)

On this page you can configure the tables that the web data connector will generate.    
`Alias` and `Description` will define the table in Tableau.    
`Table` is the zabbix table to be used for the api query (i.e. `host` uses the `host.get` method.).    
`Params` is a the json string to be used for the api query (i.e. `{"monitored_hosts":"1"}`  This must be valid json parsable by javascripts built-in JSON.parse)    
Multiple api calls/tables can be setup on this screen by clicking `Add API call` then selecting the corresponding tab for each api call.    

When you have added all the needed api calls/tables click `Submit`.  If there are no errors you will be sent to Tableaus Data Source configuration page.    

![image](https://user-images.githubusercontent.com/10260601/28503850-4e365d1a-6fd3-11e7-95bf-94c2900e3cdc.png)    

    
	
### Errors

`{"code":0,"data":"","message":""}` is caused by the web data connector not being able to connect to the supplied URL.
