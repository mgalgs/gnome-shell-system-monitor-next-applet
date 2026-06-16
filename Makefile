# -*- coding: utf-8; mode: makefile-gmake -*-

UUID = system-monitor-next@paradoxxx.zero.gmail.com
INSTALLNAME = $(UUID)
PREFIX ?= $(HOME)/.local

BASE_MODULES = \
  $(UUID)/extension.js \
  $(UUID)/base.js \
  $(UUID)/mounts.js \
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

VERSION ?= 0
ZIPFILE = $(UUID).zip

# Files that must be present in the release zip (sanity check)
RELEASE_REQUIRED = metadata.json extension.js prefs.js base.js stylesheet.css \
    schemas/gschemas.compiled widgets/cpu.js ui/prefsGeneralSettings.ui

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

help:
	@echo  'Install the extension locally (builds, installs, compiles schemas):'
	@echo  ''
	@echo  '  make install'
	@echo  ''
	@echo  'Install for packaging (schemas compiled by package manager hooks):'
	@echo  ''
	@echo  '  sudo make PREFIX=/usr install'
	@echo  '  make PREFIX=$${pkgdir}/usr install'
	@echo  ''
	@echo  'Other targets:'
	@echo  ''
	@echo  '  release   - lint, build zip, verify contents (use this for EGO uploads)'
	@echo  '  zip-file  - build zip only (no checks)'
	@echo  '  check     - run code quality checks (whitespace, lint)'
	@echo  '  clean     - remove most generated files'
	@echo  ''
	@echo  'VM Testing (requires libvirt + virt-install + passt):'
	@echo  ''
	@echo  '  vm-create       - create a test VM from cloud image'
	@echo  '  vm-create-all   - create all test VMs in the matrix'
	@echo  '  vm-test         - deploy extension to VM and run smoke test'
	@echo  '  vm-test-all     - run tests across full GNOME version matrix'
	@echo  '  vm-viewer       - open interactive graphical session'
	@echo  '  vm-ssh          - open SSH session to VM'
	@echo  '  vm-start        - start a VM'
	@echo  '  vm-stop         - gracefully shut down a VM'
	@echo  '  vm-list         - list configured VMs and their status'
	@echo  '  vm-destroy      - tear down test VM(s)'
	@echo  ''
	@echo  '  Use VM= to target a specific VM (default: first in vms.conf):'
	@echo  '    make vm-test VM=gssmn-fedora42'
	@echo  ''
	@echo  'Note that most users should install the extension via extensions.gnome.org'
	@echo  'or their distro package manager.'

install: clean build gschemas.install
	$(call msg,$@,Installing to $(INSTALLDIR))
	$(Q) mkdir -p "$(INSTALLDIR)"
	$(Q) cp $(VV) -r ./_build/* "$(INSTALLDIR)/"
# Auto-compile schemas for local installs (package managers handle their own)
ifeq ($(origin PREFIX),file)
	$(Q)glib-compile-schemas "$(SCHEMAINSTALLBASE)"
	$(call msg,gschemas,Compiled)
endif
	$(call msg,$@,OK)
	@echo ''
	@echo '  Installed to $(INSTALLDIR)'
	@echo '  Reload GNOME Shell to activate:'
	@echo '    X11:     Alt+F2, type r, press Enter'
	@echo '    Wayland: Log out and back in'
	@echo ''

uninstall:
	$(Q)gnome-extensions uninstall $(UUID)

clean: zip-file.clean build.clean

zip-file: clean build
	$(Q)cd _build ; zip $(VV) -qr $(ZIPFILE) .
	$(Q)mkdir -p dist
	$(Q)mv _build/$(ZIPFILE) ./dist/$(ZIPFILE)
	$(call msg,$@,Zip file saved to ./dist/$(ZIPFILE))
	$(call msg,$@,OK)

zip-file.clean:
	$(Q)rm $(VV) -vf ./dist/$(ZIPFILE)
	$(call msg,$@,OK)

release: check zip-file
	$(call msg,$@,Verifying zip contents...)
	$(Q)contents=$$(unzip -l dist/$(ZIPFILE)); \
	ok=true; \
	for f in $(RELEASE_REQUIRED); do \
		if ! echo "$$contents" | grep -q "$$f"; then \
			printf '  [%-12s] MISSING: %s\n' '$@' "$$f" >&2; ok=false; \
		fi; \
	done; \
	if ! $$ok; then \
		echo '' >&2; \
		printf '  [%-12s] %s\n' '$@' 'Verification FAILED! Do not upload this zip.' >&2; \
		exit 1; \
	fi
	$(call msg,$@,All required files present)
	@echo ''
	@printf '  Release zip: dist/%s (%s)\n' '$(ZIPFILE)' "$$(du -h dist/$(ZIPFILE) | cut -f1)"
	@echo '  Upload at:   https://extensions.gnome.org/upload/'
	@echo ''

gschemas: $(GSCHEMA_COMPILED)
	$(call msg,$@,OK)

gschemas.install: $(GSCHEMA_XML)
	$(Q)mkdir -p "$(SCHEMAINSTALLBASE)"
	$(Q)cp $(VV) $(GSCHEMA_XML) "$(SCHEMAINSTALLBASE)"
	$(call msg,$@,gschema installed to $(SCHEMAINSTALLBASE))
	$(call msg,$@,OK)

# Standalone target for backward compat; `make install` now auto-compiles for local installs
gschemas.install-and-compile: gschemas.install
	$(Q)glib-compile-schemas "$(SCHEMAINSTALLBASE)"
	$(call msg,$@,OK)

$(GSCHEMA_COMPILED): $(GSCHEMA_XML)
	$(Q)glib-compile-schemas ./$(UUID)/schemas/
	$(call msg,gschemas,OK)

build: gschemas translate
	$(Q)mkdir -p _build
	$(Q)cp $(VV) $(BASE_MODULES) _build
	$(Q)mkdir -p _build/schemas
	$(Q)cp $(VV) -r $(UUID)/schemas/* _build/schemas/
	$(Q)mkdir -p _build/widgets
	$(Q)cp $(VV) -r $(UUID)/widgets/* _build/widgets/
	$(Q)mkdir -p _build/ui
	$(Q)cp $(VV) -r $(UUID)/ui/* _build/ui/
	$(Q)mkdir -p _build/locale
	$(Q)cp $(VV) -r $(UUID)/locale/* _build/locale/
	$(Q)sed -i 's/"version": -1/"version": $(VERSION)/'  _build/metadata.json;
	$(call msg,$@,Extension built, saved to: _build/)
	$(call msg,$@,OK)

build.clean:
	$(Q)rm -rf ./_build
	$(call msg,$@,OK)

translate:
	$(Q)cd po;\
           ./compile.sh ../system-monitor-next@paradoxxx.zero.gmail.com/locale \
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
	$(Q)if command -v eslint >/dev/null 2>&1; then \
		eslint $(UUID); \
	else \
		echo "  [lint        ] WARNING: eslint not found, skipping"; \
	fi
	$(call msg,$@,OK)

# VM variable: target a specific VM (default: first in vms.conf)
# Usage: make vm-test VM=gssmn-fedora42
VM_ARGS = $(if $(VM),--vm $(VM),)

vm-create:
	$(call msg,$@,Creating test VM...)
	$(Q)./testing/vm/vm-create.sh $(VM_ARGS)
	$(call msg,$@,OK)

vm-create-all:
	$(call msg,$@,Creating all test VMs...)
	$(Q)./testing/vm/vm-create.sh --all
	$(call msg,$@,OK)

vm-test:
	$(call msg,$@,Running VM test...)
	$(Q)./testing/vm/vm-test.sh $(VM_ARGS)
	$(call msg,$@,OK)

vm-test-all:
	$(call msg,$@,Running VM test matrix...)
	$(Q)./testing/vm/vm-test-matrix.sh $(if $(LABEL),--label $(LABEL),) $(if $(BASELINE),--baseline $(BASELINE),)
	$(call msg,$@,OK)

vm-start:
ifndef VM
	$(error Usage: make vm-start VM=<name>  (see: make vm-list))
endif
	$(Q)virsh -c qemu:///session start $(VM)

vm-stop:
ifndef VM
	$(error Usage: make vm-stop VM=<name>  (see: make vm-list))
endif
	$(Q)virsh -c qemu:///session shutdown $(VM)

vm-stop-all:
	$(Q)for vm in $$(virsh -c qemu:///session list --name 2>/dev/null); do \
		[ -n "$$vm" ] && echo "Shutting down $$vm..." && virsh -c qemu:///session shutdown "$$vm"; \
	done

vm-viewer:
	$(Q)./testing/vm/vm-viewer.sh $(VM_ARGS)

vm-ssh:
	$(Q)./testing/vm/vm-ssh.sh $(VM_ARGS)

vm-list:
	$(Q)./testing/vm/vm-list.sh

vm-destroy:
	$(call msg,$@,Destroying test VM...)
	$(Q)./testing/vm/vm-destroy.sh $(if $(VM),--vm $(VM),--all)
	$(call msg,$@,OK)

.PHONY: help \
	install \
	release \
	zip-file \
	zip-file.clean \
	gschemas \
	gschemas.install \
	build \
	build.clean \
	translate \
	check \
	check.whitespace \
	check.lint \
	vm-create \
	vm-create-all \
	vm-test \
	vm-test-all \
	vm-start \
	vm-stop \
	vm-stop-all \
	vm-viewer \
	vm-ssh \
	vm-list \
	vm-destroy
