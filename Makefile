# -*- coding: utf-8; mode: makefile-gmake -*-
# Basic Makefile

UUID = system-monitor-next@paradoxxx.zero.gmail.com
INSTALLNAME = $(UUID)

BASE_MODULES = \
  $(UUID)/extension.js \
  $(UUID)/utils.js \
  $(UUID)/migration.js \
  $(UUID)/common.js \
  $(UUID)/README* \
  $(UUID)/metadata.json \
  $(UUID)/prefs.js \
  $(UUID)/stylesheet.css \
  $(UUID)/gpu_usage.sh

GSCHEMA_XML = $(UUID)/schemas/org.gnome.shell.extensions.system-monitor-next-applet.gschema.xml
GSCHEMA_COMPILED = $(UUID)/schemas/gschemas.compiled

# ---------
# variables
# ---------

ifeq ($(strip $(DESTDIR)),)
  INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
  SCHEMAINSTALLBASE = $(HOME)/.local/share/glib-2.0/schemas
else
  INSTALLBASE = $(DESTDIR)usr/share/gnome-shell/extensions
  SCHEMAINSTALLBASE = $(DESTDIR)usr/share/glib-2.0/schemas
endif

ifdef VERSION
  VSTRING = _v$(VERSION)
else
  VERSION = $(shell git rev-parse HEAD)
  VSTRING =
endif

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
	@echo  'Install or remove the extension, for the local user'
	@echo  'or as admin for all users:'
	@echo  ''
	@echo  '  make [install|remove]                        # for the local user'
	@echo  '  make DESTDIR=/ [install|remove] clean        # as admin for all users'
	@echo  ''
	@echo  'Use environment VERSION=n.m to set verison string in the metadata and in'
	@echo  'the generated zip-file explicit.  If no VERSION is passed, the current'
	@echo  'commit SHA1 is used as version number in the metadata while the generated'
	@echo  'zip file has no string attached.'
	@echo  ''
	@echo  'Other targets are:'
	@echo  ''
	@echo  '  zip-file  - build and zip ./$(UUID).zip'
	@echo  '  clean     - remove most generated files'
	@echo  '  gschemas  - rebuild schemas/gschemas.compiled'
	@echo  '  translate - generate translation from po/ files'
	@echo  ''
	@echo  'control verbosity:'
	@echo  ''
	@echo  '  make V=0 [targets] -> quiet build (default)'
	@echo  '  make V=1 [targets] -> verbose build'


PHONY += install remove

install: remove build gschemas-install
	$(call msg,$@,Installing to $(INSTALLBASE)/$(INSTALLNAME))
	$(Q) mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	$(Q) cp $(VV) -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	$(call msg,$@,OK)
	$(call msg,$@,Please reload GNOME Shell and enable the extension)

remove:
	$(call msg,$@,Removing $(INSTALLBASE)/$(INSTALLNAME))
ifeq ($(strip $(BUILD_FOR_RPM)),)
	$(Q) gnome-extensions uninstall --quiet $(UUID) || true
	$(Q) rm -rf $(INSTALLBASE)/$(INSTALLNAME) 2>/dev/null || true
endif
	$(call msg,$@,OK)

PHONY += zip-file zip-file.clean
ZIPFILE=$(UUID)$(VSTRING).zip

zip-file: build.clean build
	$(Q)cd _build ; zip $(V) -qr $(ZIPFILE) .
	$(Q)mkdir -p dist
	$(Q)mv _build/$(ZIPFILE) ./dist/$(ZIPFILE)
	$(call msg,$@,Zip file saved to ./dist/$(ZIPFILE))
	$(call msg,$@,OK)

zip-install: remove zip-file
	$(Q)gnome-extensions install ./dist/$(ZIPFILE)
	$(call msg,$@,OK)
	$(call msg,$@,Please reload GNOME Shell)

clean:: zip-file.clean
zip-file.clean:
	$(Q)rm $(VV) -vf ./dist/$(ZIPFILE)
	$(call msg,$@,OK)


PHONY += gschemas gschemas.clean _drop-gschemas

gschemas: _drop-gschemas $(GSCHEMA_COMPILED)
	$(call msg,$@,OK)

gschemas-install: $(GSCHEMA_XML)
	$(Q)mkdir -p $(SCHEMAINSTALLBASE)
	$(Q)cp $(VV) $(GSCHEMA_XML) $(SCHEMAINSTALLBASE)
	$(Q)glib-compile-schemas $(SCHEMAINSTALLBASE)
	$(call msg,$@,gschema installed to $(SCHEMAINSTALLBASE))
	$(call msg,$@,OK)

clean:: gschemas.clean
gschemas.clean:
	$(Q)git checkout -f -- $(GSCHEMA_COMPILED)
	$(call msg,$@,OK)

$(GSCHEMA_COMPILED): $(GSCHEMA_XML)
	$(Q)glib-compile-schemas ./$(UUID)/schemas/
	$(call msg,gschemas,OK)

_drop-gschemas:
	$(Q)rm -f $(GSCHEMA_COMPILED)


PHONY += build build.clean

build: gschemas translate
	$(Q)mkdir -p _build
	$(Q)cp $(VV) $(BASE_MODULES) _build
	$(Q)mkdir -p _build/ui
	$(Q)cp $(VV) -r $(UUID)/ui/* _build/ui/
	$(Q)mkdir -p _build/locale
	$(Q)cp $(VV) -r $(UUID)/locale/* _build/locale/
	$(Q)mkdir -p _build/schemas
	$(Q)cp $(VV) $(GSCHEMA_XML) _build/schemas/
	$(Q)cp $(VV) $(GSCHEMA_COMPILED) _build/schemas/
	$(Q)sed -i 's/"version": -1/"version": "$(VERSION)"/'  _build/metadata.json;
	$(call msg,$@,Extension built, saved to: _build/)
	$(call msg,$@,OK)

clean:: build.clean
build.clean:
	$(Q)rm -fR ./_build
	$(call msg,$@,OK)

PHONY += translate
translate: gschemas
	$(Q)cd po;\
           ./compile.sh ../system-monitor-next@paradoxxx.zero.gmail.com/locale \
	   | tr '\n' ' ' \
	   | sed -e 's/^/  [$@   ] /;'; echo
	$(call msg,$@,OK)

clean:: translation.clean
translation.clean:
	$(Q)git checkout -f -- system-monitor-next@paradoxxx.zero.gmail.com/locale

.PHONY: $(PHONY)
