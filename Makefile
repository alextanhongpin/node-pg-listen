include .env
export

start:
	@node index.js

start-%:
	@node examples/$*

up:
	@docker-compose up -d

down:
	@docker-compose down
