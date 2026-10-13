module.exports.onStart = function() { 
	console.log("Tizen", "service", "start callback"); 
}

module.exports.onRequest = function() { 
	console.log("Tizen", "service", "request callback"); 

	var reqAppControl = tizen.application.getCurrentApplication().getRequestedAppControl();

	if (reqAppControl && reqAppControl.appControl.operation == "http://tizen.org/appcontrol/operation/pick") { 
		var data = reqAppControl.appControl.data;
		
		if (data[0].value[0] == 'ForegroundApp') {
			var json = data[0].value[1]

			// Как в примере Samsung: отправили плитки — служба завершается (и при ошибке тоже). Висящая служба
			// ТВ показывал в недавних серой заглушкой вместо значка Lampa.
			webapis.preview.setPreviewData(json,
				function() { exitService(); },
				function(e) {
					console.log("Tizen", "service", "setPreviewData failed : " + e.message);
					exitService();
				}
			);
			return;
		}
	}
	exitService();
}

function exitService() {
	try { tizen.application.getCurrentApplication().exit(); } catch (e) { console.log("Tizen", "service", "exit failed : " + e.message); }
}

module.exports.onExit = function() { 
	console.log("Tizen", "service", "exit callback"); 
} 