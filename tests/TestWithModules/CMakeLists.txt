cmake_minimum_required(VERSION 3.1.0)

project(whatspoppin VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

if(CMAKE_VERSION VERSION_LESS "3.7.0")
  set(CMAKE_INCLUDE_CURRENT_DIR ON)
endif()

if(DEFINED ENV{Qt5_DIR})
  find_package(Qt5 COMPONENTS WebEngineWidgets REQUIRED)
  add_executable(whatspoppin main.cpp)
  target_link_libraries(whatspoppin Qt5::WebEngineWidgets)
else()
  find_package(Qt6 REQUIRED COMPONENTS Core WebEngineWidgets)
  qt_standard_project_setup()
  add_executable(whatspoppin main.cpp)
  target_link_libraries(whatspoppin PRIVATE Qt::WebEngineWidgets Qt6::Core)
endif()

