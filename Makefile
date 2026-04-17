# -*- coding: utf-8; mode: makefile-gmake -*-

UUID = system-monitor-next@paradoxxx.zero.gmail.com
INSTALLNAME = $(UUID)
PREFIX ?= $(HOME)/.local
LINTERCMD ?= eslint

BASE_MODULES = \
  $(UUID)/extension.js \
  $(UUID)/README* \
  $(UUID)/metadata.json \
  $(UUID)/prefs.js \
  $(UUID)/stylesheet.css \
  $(UUID)/convenience.js \
  $(UUID)/compat.js \
  $(UUID)/gpu_usage.sh

GSCHEMA_XML = $(UUID)/schemas/org.gnome.shell.extensions.system-monitor.gschema.xml
GSCHEMA_COMPILED = $(UUID)/schemas/gschemas.compiled

VERSION ?= 0
ZIPFILE = $(UUID).zip

INSTALLBASE = $(PREFIX)/share/gnome-shell/extensions
SCHEMAINSTALLBASE = $(PREFIX)/share/glib-2.0/schemas
INSTALLDIR = $(INSTALLBASE)/$(INSTALLNAME)

# VERBOSE level

ifeq ($(V),1)
  Q =
  VV = -v
else
  Q = @
  VV =
endif

# -------
# macros
# -------

# usage: $(call msg,INFO,'lorem ipsum')
msg = @printf '  [%-12s] %s\n' '$(1)' '$(2)'

# -------
# targets
# -------

# is there anymore use of the (old) 'all' target?
# PHONY += all
# all: extension

PHONY += help
help:
	@echo  'Install or remove (and reload) of the extension, for the local user'
	@echo  'or as admin for all users:'
	@echo  ''
	@echo  '  make install'
	@echo  ''
	@echo  'Install the extension to $${PREFIX}/share/ (for system-wide install/packaging):'
	@echo  ''
	@echo  '  sudo make PREFIX=/usr install       # as admin for all users'
	@echo  '  make PREFIX=$${pkgdir}/usr install   # to another directory (for packaging)'
	@echo  ''
	@echo  'Other targets:'
	@echo  ''
	@echo  '  zip-file  - build $(ZIPFILE)'
	@echo  '              (which can be uploaded to extensions.gnome.org or installed'
	@echo  '               with gnome-extensions install)'
	@echo  '  check     - run code quality checks (whitespace, lint)'
	@echo  '  clean     - remove most generated files'
	@echo  ''
	@echo  'Note that most users should install the extension via extensions.gnome.org'
	@echo  'or their distro package manager.'

install: clean build gschemas.install
	$(call msg,$@,Installing to $(INSTALLDIR))
	$(Q) mkdir -p "$(INSTALLDIR)"
	$(Q) cp $(VV) -r ./_build/* "$(INSTALLDIR)/"
	$(call msg,$@,OK)
	$(call msg,$@,Please reload GNOME Shell and enable the extension)

uninstall:
	$(Q)gnome-extensions uninstall $(UUID)

clean: zip-file.clean build.clean

zip-file: clean build
	$(Q)cd _build ; zip $(V) -qr $(ZIPFILE) .
	$(Q)mkdir -p dist
	$(Q)mv _build/$(ZIPFILE) ./dist/$(ZIPFILE)
	$(call msg,$@,Zip file saved to ./dist/$(ZIPFILE))
	$(call msg,$@,OK)

zip-file.clean:
	$(Q)rm $(VV) -vf ./dist/$(ZIPFILE)
	$(call msg,$@,OK)

gschemas: $(GSCHEMA_COMPILED)
	$(call msg,$@,OK)

gschemas.install: $(GSCHEMA_XML)
	$(Q)mkdir -p "$(SCHEMAINSTALLBASE)"
	$(Q)cp $(VV) $(GSCHEMA_XML) "$(SCHEMAINSTALLBASE)"
	$(call msg,$@,gschema installed to $(SCHEMAINSTALLBASE). You might need to run "glib-compile-schemas $(SCHEMAINSTALLBASE)")
	$(call msg,$@,OK)

# Not part of regular install since this is usually done by package manager hooks
gschemas.install-and-compile: gschemas.install
	$(Q)glib-compile-schemas "$(SCHEMAINSTALLBASE)"
	$(call msg,$@,OK)

$(GSCHEMA_COMPILED): $(GSCHEMA_XML)
	$(Q)glib-compile-schemas ./$(UUID)/schemas/
	$(call msg,gschemas,OK)

build: gschemas translate
	$(Q)mkdir -p _build
	$(Q)cp $(VV) $(BASE_MODULES) _build
	$(Q)mkdir -p _build/locale
	$(Q)cp $(VV) -r $(UUID)/locale/* _build/locale/
	$(Q)mkdir -p _build/schemas
	$(Q)cp $(VV) $(UUID)/schemas/*.xml _build/schemas/
	$(Q)cp $(VV)  $(UUID)/schemas/gschemas.compiled _build/schemas/
	$(Q)sed -i 's/"version": -1/"version": "$(VERSION)"/'  _build/metadata.json;
	$(call msg,$@,Extension built, saved to: _build/)
	$(call msg,$@,OK)

build.clean:
	$(Q)rm -rf ./_build
	$(call msg,$@,OK)

translate:
	$(Q)mkdir -p $(UUID)/locale && cd po &&\
           ./compile.sh ../$(UUID)/locale \
	   | tr '\n' ' ' \
	   | sed -e 's/^/  [$@   ] /;'; echo
	$(call msg,$@,OK)

check: check.whitespace check.lint
	$(call msg,$@,All checks passed)

check.whitespace:
	$(call msg,$@,Checking for whitespace issues...)
	$(Q)if git rev-parse --git-dir > /dev/null 2>&1; then \
		git diff --check HEAD 2>/dev/null || (echo '  [whitespace  ] Changes have whitespace issues' && exit 1); \
		git diff --cached --check 2>/dev/null || (echo '  [whitespace  ] Staged changes have whitespace issues' && exit 1); \
	fi
	$(call msg,$@,OK)

check.lint:
	$(call msg,$@,Running ESLint...)
	$(Q)if command -v $(LINTERCMD) >/dev/null 2>&1; then \
		$(LINTERCMD) $(UUID); \
	else \
		echo "  [lint        ] WARNING: $(LINTERCMD) not found, skipping"; \
	fi
	$(call msg,$@,OK)

PHONY: help \
	install \
	zip-file \
	zip-file.clean \
	gschemas \
	gschemas.install \
	build \
	build.clean \
	translate \
	check \
	check.whitespace \
	check.lint
