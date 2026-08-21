// Package locales carries the product's single translation catalogue. The Go
// server and the browser app both read locales/strings.json, so a word only
// ever has to be changed in one place.
package locales

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed strings.json
var raw []byte

// Default is the language used when CG_LANG says nothing usable.
const Default = "en"

type catalogue struct {
	Languages []string                     `json:"languages"`
	App       map[string]map[string]string `json:"app"`
	Errors    map[string]map[string]string `json:"errors"`
	Visitor   map[string]map[string]string `json:"visitor"`
	Months    map[string][]string          `json:"months"`
}

var (
	once   sync.Once
	loaded catalogue
)

func load() catalogue {
	once.Do(func() {
		// The file is embedded and validated by the tests; a broken catalogue
		// degrades to English rather than stopping the server from booting.
		_ = json.Unmarshal(raw, &loaded)
	})
	return loaded
}

// Supported reports whether a language code has translations in the catalogue.
func Supported(lang string) bool {
	lang = Normalise(lang)
	for _, l := range load().Languages {
		if l == lang {
			return true
		}
	}
	return false
}

// Normalise turns "fr-CA", " FR " and "" into a bare lowercase code.
func Normalise(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if i := strings.IndexAny(lang, "-_"); i > 0 {
		lang = lang[:i]
	}
	return lang
}

// Raw is the catalogue exactly as it sits on disk, for handing to the browser.
func Raw() []byte { return raw }

func pick(section map[string]map[string]string, key, lang string) (string, bool) {
	entry, ok := section[key]
	if !ok {
		return "", false
	}
	if v, ok := entry[lang]; ok && v != "" {
		return v, true
	}
	v, ok := entry[Default]
	return v, ok
}

// Visitor returns a string from the visitor-page section, falling back to the
// English source and then to the key itself.
func Visitor(lang, key string, vars ...string) string {
	v, ok := pick(load().Visitor, key, lang)
	if !ok {
		v = key
	}
	return substitute(v, vars)
}

// Error translates one of the API's refusal messages. It is keyed by the
// English message so the call sites stay plain Go strings; anything the
// catalogue does not know is passed through unchanged.
func Error(lang, msg string) string {
	if v, ok := pick(load().Errors, msg, lang); ok {
		return v
	}
	return msg
}

// Month is the name of a month, 1-indexed, for the one date the server has to
// format on its own.
func Month(lang string, m int) string {
	months := load().Months
	names, ok := months[lang]
	if !ok || len(names) < 12 {
		names = months[Default]
	}
	if m < 1 || m > len(names) {
		return ""
	}
	return names[m-1]
}

// substitute replaces {placeholders}, taking its arguments in name, value
// pairs: substitute(s, []string{"date", "3 May 2026"}).
func substitute(s string, vars []string) string {
	for i := 0; i+1 < len(vars); i += 2 {
		s = strings.ReplaceAll(s, "{"+vars[i]+"}", vars[i+1])
	}
	return s
}
