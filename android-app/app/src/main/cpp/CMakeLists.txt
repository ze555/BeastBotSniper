cmake_minimum_required(VERSION 3.22.1)
project(beastbot_node_bridge)
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION "${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so"
)
add_library(nodebridge SHARED node_bridge.cpp)
target_include_directories(nodebridge PRIVATE "${CMAKE_SOURCE_DIR}/libnode/include/node")
find_library(log-lib log)
find_library(android-lib android)
target_link_libraries(nodebridge node ${log-lib} ${android-lib})
