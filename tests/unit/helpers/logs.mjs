export async function captureConsoleLog(function_) {
	const logs = [];
	const original = console.log;
	console.log = (...arguments_) => {
		logs.push(arguments_.join(" "));
	};
	try {
		await function_();
	} finally {
		console.log = original;
	}
	return logs;
}
