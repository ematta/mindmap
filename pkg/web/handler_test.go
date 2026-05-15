package web

import (
	"testing"
)

func TestContextMethods(t *testing.T) {
	// Test Param method
	ctx := &Context{
		Params: map[string]string{
			"id":   "123",
			"name": "test",
		},
	}

	if ctx.Param("id") != "123" {
		t.Errorf("Param('id') = %s; want 123", ctx.Param("id"))
	}

	if ctx.Param("missing") != "" {
		t.Errorf("Param('missing') = %s; want empty", ctx.Param("missing"))
	}

	// Test nil Params
	ctx2 := &Context{}
	if ctx2.Param("anything") != "" {
		t.Errorf("Param on nil Params should return empty string")
	}
}
