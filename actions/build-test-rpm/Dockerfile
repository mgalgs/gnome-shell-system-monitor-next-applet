ARG FEDORA_VERSION=43
FROM fedora:${FEDORA_VERSION}

RUN dnf -y update && \
    dnf -y install \
    gcc \
    gettext \
    git \
    glib2-devel \
    make \
    rpm-build \
    sudo

RUN useradd -m builder && echo "builder ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/builder
USER builder
WORKDIR /home/builder

COPY entry.sh /home/builder/
CMD ["/home/builder/entry.sh"]
