package main

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type config struct {
	host          string
	port          string
	allowedOrigin string
}

func loadConfig(getenv func(string) string) (config, error) {
	c := config{
		host:          getenv("HOST"),
		port:          getenv("PORT"),
		allowedOrigin: getenv("ALLOWED_ORIGIN"),
	}
	if c.host == "" {
		c.host = "127.0.0.1"
	}
	if c.port == "" {
		c.port = "8080"
	}
	port, err := strconv.ParseUint(c.port, 10, 16)
	if err != nil || port == 0 {
		return config{}, fmt.Errorf("PORT must be an integer from 1 to 65535")
	}
	if c.allowedOrigin != "" {
		origin, err := url.Parse(c.allowedOrigin)
		if err != nil || (origin.Scheme != "https" && origin.Scheme != "http") ||
			origin.Hostname() == "" || strings.Contains(origin.Host, "*") || origin.User != nil ||
			c.allowedOrigin != origin.Scheme+"://"+origin.Host {
			return config{}, fmt.Errorf("ALLOWED_ORIGIN must be an http(s) origin without credentials, a path, query, fragment, or trailing slash")
		}
	}
	return c, nil
}
