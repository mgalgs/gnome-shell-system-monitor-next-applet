FROM archlinux:base-devel-20250427.0.341977

RUN pacman -Syu --noconfirm \
    git \
    gnome-shell \
    libgtop \
    sudo

RUN useradd -m builder && echo "builder ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/builder
USER builder
WORKDIR /home/builder

COPY entry.sh /home/builder/
CMD ["/home/builder/entry.sh"]
