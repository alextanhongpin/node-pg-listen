include .env
export

start:
	@node index.js

up:
	@docker-compose up -d

down:
	@docker-compose down
