package main

import (
	"context"
	"log"

	"shop/internal/app"
)

func main() {
	ctx := context.Background()

	application, err := app.New(ctx)
	if err != nil {
		log.Fatal(err)
	}

	if err := application.Run(ctx); err != nil {
		log.Fatal(err)
	}
}
