FROM gitpod/workspace-full-vnc:latest

USER root
# Install custom tools, runtime, etc.
RUN apt-get update \
    # window manager
    && apt-get install -y jwm \
    # electron
    && apt-get install -y libgtk-3-0 libnss3 libasound2 \
    # native-keymap
    && apt-get install -y libx11-dev libxkbfile-dev x11-apps\
    && apt-get clean && rm -rf /var/cache/apt/* && rm -rf /var/lib/apt/lists/* && rm -rf /tmp/*
RUN cd ~/ && wget http://download.eclipse.org/tracecompass/releases/5.1.0/rcp/trace-compass-5.1.0-20190911-0900-linux.gtk.x86_64.tar.gz \
    && tar xzvf *.tar.gz && rm *.tar.gz 
    # \
    # && ln -s /usr/bin/eclipse /home/gitpod/eclipse/eclipse

USER gitpod
# Apply user-specific settings
RUN bash -c ". .nvm/nvm.sh \
    && nvm install 10 \
    && nvm use 10 \
    && npm install -g yarn"

# Give back control
USER root
