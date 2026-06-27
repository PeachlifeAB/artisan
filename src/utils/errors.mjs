export class ArtisanError extends Error {
	constructor(message, exitCode = 1) {
		super(message);
		this.name = "ArtisanError";
		this.exitCode = exitCode;
	}
}

export class UsageError extends ArtisanError {
	constructor(message) {
		super(message, 2);
		this.name = "UsageError";
	}
}

export class DockerError extends ArtisanError {
	constructor(message) {
		super(message, 125);
		this.name = "DockerError";
	}
}

export class InterruptError extends ArtisanError {
	constructor(message = "Interrupted") {
		super(message, 130);
		this.name = "InterruptError";
	}
}
